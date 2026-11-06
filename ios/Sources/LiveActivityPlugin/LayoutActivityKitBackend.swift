import ActivityKit
import Foundation
import LiveActivityShared
#if canImport(LiveActivityCore)
import LiveActivityCore
#endif

/// ActivityKit for layout activities (`Activity<LiveActivityLayoutAttributes>`).
@available(iOS 16.1, *)
@MainActor
final class LayoutActivityKitBackend: LayoutActivityBackend {
    private let system = ActivityKitAdapter<LiveActivityLayoutAttributes>(schemaVersion: 2)

    func preflightStart() throws { try system.preflightStart() }

    func preflightLayoutWidget() throws { try LayoutWidgetPreflight.check(plugIns: Bundle.main.builtInPlugInsURL) }

    func list() async -> [LayoutActivity] { system.activities.map(describe) }

    func start(_ attributes: LiveActivityLayoutAttributes, snapshot: LayoutSnapshot) async throws -> LayoutActivity {
        describe(try system.start(attributes, state: snapshot))
    }

    func update(_ activity: LayoutActivity, snapshot: LayoutSnapshot) async throws -> LayoutActivity {
        describe(try await system.update(activity.id, state: snapshot))
    }

    func end(_ activity: LayoutActivity, policy: EndPolicy) async throws -> LayoutActivity {
        try await system.end(activity.id, state: activity.snapshot, policy: policy)
        return LayoutActivity(id: activity.id, attributes: activity.attributes, snapshot: activity.snapshot, state: "ended")
    }

    func endKeepingContent(_ activity: LayoutActivity, policy: EndPolicy) async throws -> LayoutActivity {
        try await system.end(activity.id, state: nil, policy: policy)
        return LayoutActivity(id: activity.id, attributes: activity.attributes, snapshot: activity.snapshot, state: "ended")
    }

    private func describe(_ activity: Activity<LiveActivityLayoutAttributes>) -> LayoutActivity {
        LayoutActivity(id: activity.attributes.instanceID, attributes: activity.attributes, snapshot: system.state(of: activity),
                       state: system.lifecycle(of: activity))
    }
}
