import Foundation
#if canImport(LiveActivityShared)
import LiveActivityShared
#endif

/// A layout activity as the system reports it.
public struct LayoutActivity: Sendable {
    public let id: String
    public let attributes: LiveActivityLayoutAttributes
    public let snapshot: LayoutSnapshot
    public let state: String
    public init(id: String, attributes: LiveActivityLayoutAttributes, snapshot: LayoutSnapshot, state: String) {
        self.id = id; self.attributes = attributes; self.snapshot = snapshot; self.state = state
    }
    public var record: LayoutActivityRecord {
        LayoutActivityRecord(id: id, activityKey: attributes.activityKey, schemaVersion: attributes.schemaVersion, snapshot: snapshot, state: state)
    }
}

/// The result of the layout commands. It carries no template and does not echo the layout.
public struct LayoutActivityRecord: Encodable, Sendable {
    public let id: String
    public let activityKey: String
    public let schemaVersion: Int
    public let snapshot: LayoutSnapshot
    public let backend = "activityKit"
    public let state: String
    public let visibility = "unknown"
    public let degradedFeatures: [String] = []
    public let promotionRequested = false
    public let promotionState = "notApplicable"
    init(id: String, activityKey: String, schemaVersion: Int, snapshot: LayoutSnapshot, state: String) {
        self.id = id; self.activityKey = activityKey; self.schemaVersion = schemaVersion; self.snapshot = snapshot; self.state = state
    }
}

@MainActor
public protocol LayoutActivityBackend: AnyObject {
    func preflightStart() throws
    /// Throws CONFIGURATION_REQUIRED unless a widget extension built from the layout template is embedded.
    func preflightLayoutWidget() throws
    func list() async -> [LayoutActivity]
    func start(_ attributes: LiveActivityLayoutAttributes, snapshot: LayoutSnapshot) async throws -> LayoutActivity
    func update(_ activity: LayoutActivity, snapshot: LayoutSnapshot) async throws -> LayoutActivity
    /// Ends the activity with `activity.snapshot` as its final content.
    func end(_ activity: LayoutActivity, policy: EndPolicy) async throws -> LayoutActivity
    /// Ends the activity without new content, so the system keeps what it last published.
    func endKeepingContent(_ activity: LayoutActivity, policy: EndPolicy) async throws -> LayoutActivity
}

extension LayoutActivityBackend {
    /// A backend that does not implement it ends with `activity.snapshot`.
    public func endKeepingContent(_ activity: LayoutActivity, policy: EndPolicy) async throws -> LayoutActivity {
        try await end(activity, policy: policy)
    }
}

/// The layout-widget start preflight: an embedded app extension whose Info.plist sets
/// `TauriLiveActivityLayout` to the integer 2.
public enum LayoutWidgetPreflight {
    public static let infoKey = "TauriLiveActivityLayout"
    public static let version = 2

    /// `plugIns` is the app's `Bundle.main.builtInPlugInsURL`.
    public static func check(plugIns: URL?) throws {
        let bundles = plugIns.flatMap { try? FileManager.default.contentsOfDirectory(at: $0, includingPropertiesForKeys: nil) } ?? []
        guard bundles.contains(where: isLayoutWidget) else {
            throw ActivityFailure("CONFIGURATION_REQUIRED", "Embed a widget extension built from the layout template.")
        }
    }

    private static func isLayoutWidget(_ bundle: URL) -> Bool {
        guard bundle.pathExtension == "appex", let data = try? Data(contentsOf: bundle.appendingPathComponent("Info.plist")),
              let info = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any] else { return false }
        return info[infoKey] as? Int == version
    }
}

extension LayoutActivity: LifecycleActivity {
    typealias Attributes = LiveActivityLayoutAttributes
    static let schemaVersion = 2
    static let instancePrefix = "la-ios-layout-"
    static func content(_ snapshot: LayoutSnapshot) -> StoredReceipt.Content { .layout(snapshot) }
    static func snapshot(in content: StoredReceipt.Content) -> LayoutSnapshot? {
        if case .layout(let snapshot) = content { return snapshot } else { return nil }
    }
    static func revision(of snapshot: LayoutSnapshot) -> Int64 { snapshot.revision }
    static func record(_ entry: StoredReceipt) -> LayoutActivityRecord {
        LayoutActivityRecord(id: entry.id, activityKey: entry.summary.activityKey, schemaVersion: entry.summary.schemaVersion,
                             snapshot: snapshot(in: entry.content) ?? LayoutSnapshot(revision: entry.revision, values: [:]), state: entry.state)
    }
    var summary: ReceiptSummary {
        ReceiptSummary(activityKey: attributes.activityKey, schemaVersion: attributes.schemaVersion, template: nil,
                       fingerprint: attributes.initialFingerprint)
    }
    func with(snapshot: LayoutSnapshot, state: String) -> LayoutActivity {
        LayoutActivity(id: id, attributes: attributes, snapshot: snapshot, state: state)
    }
}

extension LifecycleBackend where Activity == LayoutActivity {
    init(_ backend: LayoutActivityBackend) {
        self.init(preflight: { try backend.preflightStart(); try backend.preflightLayoutWidget() }, list: { await backend.list() },
                  start: { try await backend.start($0, snapshot: $1) }, update: { try await backend.update($0, snapshot: $1) },
                  end: { try await backend.end($0, policy: $1) }, endKeepingContent: { try await backend.endKeepingContent($0, policy: $1) })
    }
}

/// The lifecycle of layout activities: the v1 rules over the v2 payload.
@MainActor
public final class LayoutActivityController {
    private let lifecycle: ActivityLifecycle<LayoutActivity>
    public init(backend: LayoutActivityBackend, store: FileReceiptStore? = nil) {
        lifecycle = ActivityLifecycle(backend: LifecycleBackend(backend), storage: store.map { .file($0) } ?? .memory())
    }

    public func start(_ request: LayoutRequest) async throws -> LayoutActivityRecord {
        try request.validate()
        return try await lifecycle.start(key: request.activityKey, fingerprint: request.fingerprint, snapshot: request.snapshot) { id in
            let attributes = try LiveActivityLayoutAttributes(request: request, instanceID: id)
            try PayloadLimit.check(attributes: attributes, snapshot: request.snapshot)
            return attributes
        }
    }

    /// The values must keep the keys and types accepted at start and satisfy the stored layout.
    public func update(_ request: LayoutUpdateRequest) async throws -> LayoutActivityRecord {
        try request.validate()
        return try await lifecycle.update(id: request.id, snapshot: request.snapshot,
            validate: { try request.snapshot.validate(replacing: $0.snapshot, in: $0.attributes.document) },
            check: { try PayloadLimit.check(attributes: $0.attributes, snapshot: request.snapshot) })
    }

    public func end(_ request: LayoutEndRequest) async throws -> LayoutActivityRecord {
        try request.validate()
        return try await lifecycle.end(id: request.id, policy: request.policy)
    }

    public func list() async throws -> [LayoutActivityRecord] {
        try await lifecycle.list()
    }
}
