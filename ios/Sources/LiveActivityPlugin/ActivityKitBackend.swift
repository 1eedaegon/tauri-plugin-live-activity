import ActivityKit
import Foundation
import LiveActivityShared
#if canImport(LiveActivityCore)
import LiveActivityCore
#endif

@available(iOS 16.1, *)
@MainActor
final class ActivityKitBackend: ActivityBackend {
    private let system = ActivityKitAdapter<LiveActivityAttributes>(schemaVersion: 1)

    func preflightStart() throws { try system.preflightStart() }

    func list() async -> [NativeActivity] { system.activities.map(describe) }

    func start(_ attributes: LiveActivityAttributes, snapshot: ActivitySnapshot) async throws -> NativeActivity {
        describe(try system.start(attributes, state: snapshot))
    }

    func update(_ previous: NativeActivity, snapshot: ActivitySnapshot) async throws -> NativeActivity {
        describe(try await system.update(previous.id, state: snapshot))
    }

    func end(_ previous: NativeActivity, policy: EndPolicy) async throws -> NativeActivity {
        try await system.end(previous.id, state: previous.snapshot, policy: policy)
        return NativeActivity(id: previous.id, attributes: previous.attributes, snapshot: previous.snapshot, state: "ended")
    }

    func endKeepingContent(_ previous: NativeActivity, policy: EndPolicy) async throws -> NativeActivity {
        try await system.end(previous.id, state: nil, policy: policy)
        return NativeActivity(id: previous.id, attributes: previous.attributes, snapshot: previous.snapshot, state: "ended")
    }

    private func describe(_ activity: Activity<LiveActivityAttributes>) -> NativeActivity {
        NativeActivity(id: activity.attributes.instanceID, attributes: activity.attributes, snapshot: system.state(of: activity),
                       state: system.lifecycle(of: activity))
    }
}
