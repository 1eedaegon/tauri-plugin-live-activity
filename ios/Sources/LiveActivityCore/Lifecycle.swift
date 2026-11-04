import Foundation
#if canImport(LiveActivityShared)
import LiveActivityShared
#endif

public struct NativeActivity: Codable, Sendable {
    public let id: String
    public let attributes: LiveActivityAttributes
    public let snapshot: ActivitySnapshot
    public let state: String
    public init(id: String, attributes: LiveActivityAttributes, snapshot: ActivitySnapshot, state: String) {
        self.id = id; self.attributes = attributes; self.snapshot = snapshot; self.state = state
    }
    public var record: ActivityRecord { ActivityRecord(activity: self) }
}

public struct ActivityRecord: Encodable, Sendable {
    public let id: String
    public let activityKey: String
    public let schemaVersion: Int
    public let template: String
    public let snapshot: ActivitySnapshot
    public let backend = "activityKit"
    public let state: String
    public let visibility = "unknown"
    public let degradedFeatures: [String] = []
    public let promotionRequested = false
    public let promotionState = "notApplicable"
    public init(activity: NativeActivity) {
        id = activity.id; activityKey = activity.attributes.activityKey
        schemaVersion = activity.attributes.schemaVersion; template = activity.attributes.template
        snapshot = activity.snapshot; state = activity.state
    }
}

@MainActor
public protocol ActivityBackend: AnyObject {
    func preflightStart() throws
    func list() async -> [NativeActivity]
    func start(_ attributes: LiveActivityAttributes, snapshot: ActivitySnapshot) async throws -> NativeActivity
    func update(_ activity: NativeActivity, snapshot: ActivitySnapshot) async throws -> NativeActivity
    func end(_ activity: NativeActivity, policy: EndPolicy) async throws -> NativeActivity
}

/// Holds the lock across suspension points; an actor alone would permit reentrant updates.
@MainActor
final class SerialOperationQueue {
    private var busy = false
    private var waiters: [CheckedContinuation<Void, Never>] = []
    func run<T>(_ operation: () async throws -> T) async rethrows -> T {
        if busy { await withCheckedContinuation { waiters.append($0) } }
        busy = true
        defer {
            if waiters.isEmpty { busy = false } else { waiters.removeFirst().resume() }
        }
        return try await operation()
    }
}

@MainActor
public final class LiveActivityController {
    private let backend: ActivityBackend
    private let queue = SerialOperationQueue()
    private let store: ActivityReceiptStore?
    private var receipts: [NativeActivity] = []
    private var loaded = false
    private let tombstoneLimit = 128
    public init(backend: ActivityBackend, store: ActivityReceiptStore? = nil) { self.backend = backend; self.store = store }

    private func load() throws {
        if loaded { return }
        receipts = try store?.load() ?? []
        loaded = true
    }

    private func remember(_ activity: NativeActivity) throws {
        let others = receipts.filter { $0.id != activity.id }
        let active = others.filter { ["active", "stale"].contains($0.state) }
        let finished = others.filter { !["active", "stale"].contains($0.state) }
        let candidates = active + Array(finished.suffix(tombstoneLimit - 1)) + [activity]
        receipts = Array(candidates.suffix(256))
        try store?.save(receipts)
    }

    private func observed() async -> [NativeActivity] {
        await backend.list().map { activity in
            guard let receipt = receipts.first(where: { $0.id == activity.id }) else { return activity }
            if ["ended", "dismissed"].contains(receipt.state) { return receipt }
            if receipt.snapshot.revision > activity.snapshot.revision {
                return NativeActivity(id: activity.id, attributes: activity.attributes, snapshot: receipt.snapshot, state: activity.state)
            }
            return activity
        }
    }

    public func start(_ request: StartRequest) async throws -> ActivityRecord {
        try request.validate()
        return try await queue.run {
            try self.load()
            let existing = await self.observed().first {
                $0.attributes.activityKey == request.activityKey && ["active", "stale"].contains($0.state)
            }
            if let existing = existing {
                guard existing.attributes.initialFingerprint == (try request.fingerprint()) else {
                    throw ActivityFailure("CONFLICT", "An activity with this key already exists with different input.")
                }
                return existing.record
            }
            try self.backend.preflightStart()
            let attributes = try LiveActivityAttributes(request: request, instanceID: "la-ios-" + UUID().uuidString)
            try PayloadLimit.check(attributes: attributes, snapshot: request.snapshot)
            let result = try await self.backend.start(attributes, snapshot: request.snapshot)
            try self.remember(result)
            return result.record
        }
    }

    public func update(_ request: UpdateRequest) async throws -> ActivityRecord {
        try await queue.run {
            try self.load()
            let activity = try await self.active(request.id)
            try request.snapshot.validate(template: activity.attributes.template)
            guard request.snapshot.revision >= activity.snapshot.revision else {
                throw ActivityFailure("STALE_REVISION", "The revision is older than the current activity state.")
            }
            if request.snapshot.revision == activity.snapshot.revision {
                guard request.snapshot == activity.snapshot else {
                    throw ActivityFailure("CONFLICT", "This revision already contains different state.")
                }
                return activity.record
            }
            try PayloadLimit.check(attributes: activity.attributes, snapshot: request.snapshot)
            let observed = try await self.backend.update(activity, snapshot: request.snapshot)
            let accepted = NativeActivity(id: observed.id, attributes: observed.attributes, snapshot: request.snapshot, state: observed.state)
            try self.remember(accepted)
            return accepted.record
        }
    }

    public func end(_ request: EndRequest) async throws -> ActivityRecord {
        try await queue.run {
            try self.load()
            if let known = self.receipts.first(where: { $0.id == request.id && ["ended", "dismissed"].contains($0.state) }) { return known.record }
            if let terminal = await self.observed().first(where: { $0.id == request.id && ["ended", "dismissed"].contains($0.state) }) {
                try self.remember(terminal)
                return terminal.record
            }
            try request.policy.validate()
            let activity = try await self.active(request.id)
            let result = try await self.backend.end(activity, policy: request.policy)
            try self.remember(result)
            return result.record
        }
    }

    public func list() async throws -> [ActivityRecord] {
        try await queue.run {
            try self.load()
            return await self.observed().map(\.record)
        }
    }

    private func active(_ id: String) async throws -> NativeActivity {
        guard !receipts.contains(where: { $0.id == id && ["ended", "dismissed"].contains($0.state) }),
              let activity = await observed().first(where: { $0.id == id }),
              ["active", "stale"].contains(activity.state) else {
            throw ActivityFailure("NOT_FOUND", "The active activity was not found.")
        }
        return activity
    }
}
