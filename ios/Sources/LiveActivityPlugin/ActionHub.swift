import ActivityKit
import Foundation
import LiveActivityShared
#if canImport(LiveActivityCore)
import LiveActivityCore
#endif

/// The plugin's end of `LiveActivityActionIntent` (templates/ios): an `ActionRelay` that names the activity key of a
/// tap while ActivityKit still lists the layout activity.
final class ActionHub {
    private let relay: ActionRelay

    init(center: NotificationCenter = .default, activityKey: @escaping (String) -> String? = ActionHub.layoutActivityKey) {
        relay = ActionRelay(center: center, activityKey: activityKey)
    }

    /// Delivers the waiting taps and every later one to `sink`, never on the main thread. Returns at once.
    func register(_ sink: @escaping (LiveActivityAction) -> Void) { relay.register(sink) }

    /// The key of the layout activity with this handle, while ActivityKit still lists it.
    static func layoutActivityKey(_ id: String) -> String? {
        guard #available(iOS 16.1, *) else { return nil }
        return Activity<LiveActivityLayoutAttributes>.activities.first { $0.attributes.instanceID == id }?.attributes.activityKey
    }
}
