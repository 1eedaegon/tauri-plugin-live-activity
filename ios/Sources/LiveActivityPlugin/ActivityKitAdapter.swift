import ActivityKit
import Foundation
import UIKit
import LiveActivityShared

/// A content state that may carry a stale time (`ActivitySnapshot`, `LayoutSnapshot`).
protocol StaleDated { var staleAt: Int64? { get } }
extension ActivitySnapshot: StaleDated {}
extension LayoutSnapshot: StaleDated {}

/// The attributes types the plugin publishes; both carry the plugin's handle and contract version.
@available(iOS 16.1, *)
protocol PluginActivityAttributes: ActivityAttributes where ContentState: StaleDated {
    var instanceID: String { get }
    var schemaVersion: Int { get }
}
@available(iOS 16.1, *)
extension LiveActivityAttributes: PluginActivityAttributes {}
@available(iOS 16.1, *)
extension LiveActivityLayoutAttributes: PluginActivityAttributes {}

/// The ActivityKit calls both contract versions share, for one attributes type.
@available(iOS 16.1, *)
@MainActor
struct ActivityKitAdapter<Attributes: PluginActivityAttributes> {
    typealias SystemActivity = Activity<Attributes>
    let schemaVersion: Int

    func preflightStart() throws {
        guard Bundle.main.object(forInfoDictionaryKey: "NSSupportsLiveActivities") as? Bool == true else {
            throw ActivityFailure("CONFIGURATION_REQUIRED", "Enable NSSupportsLiveActivities in the host app and embed the widget extension.")
        }
        guard ActivityAuthorizationInfo().areActivitiesEnabled else {
            throw ActivityFailure("PERMISSION_DENIED", "Live Activities are disabled in system settings.")
        }
        guard UIApplication.shared.applicationState == .active else {
            throw ActivityFailure("CONFIGURATION_REQUIRED", "Start local Live Activities while the host app is in the foreground.")
        }
    }

    var activities: [SystemActivity] {
        SystemActivity.activities.filter { $0.attributes.schemaVersion == schemaVersion }
    }

    func start(_ attributes: Attributes, state: Attributes.ContentState) throws -> SystemActivity {
        do {
            if #available(iOS 16.2, *) {
                return try SystemActivity.request(attributes: attributes, content: content(state), pushType: nil)
            }
            try requireLegacyState(state)
            return try SystemActivity.request(attributes: attributes, contentState: state, pushType: nil)
        } catch let failure as ActivityFailure { throw failure }
        catch let failure as ActivityAuthorizationError { throw mapAuthorizationError(failure) }
        catch { throw ActivityFailure("NATIVE_ERROR", "ActivityKit could not start the activity.") }
    }

    func update(_ id: String, state: Attributes.ContentState) async throws -> SystemActivity {
        let activity = try find(id)
        if #available(iOS 16.2, *) {
            await activity.update(content(state))
        } else {
            try requireLegacyState(state)
            await activity.update(using: state)
        }
        return activity
    }

    /// Ends the activity showing `state`, the last accepted one, or without new content when `state` is nil: the
    /// system then keeps what it last published.
    func end(_ id: String, state: Attributes.ContentState?, policy: EndPolicy) async throws {
        let activity = try find(id)
        let dismissal: ActivityUIDismissalPolicy
        switch policy.kind {
        case "immediate": dismissal = .immediate
        case "after":
            guard let at = policy.at else { throw ActivityFailure("INVALID_INPUT", "A dismissal timestamp is required.") }
            dismissal = .after(Date(timeIntervalSince1970: Double(at) / 1000))
        default: dismissal = .default
        }
        if #available(iOS 16.2, *) { await activity.end(state.map { content($0) }, dismissalPolicy: dismissal) }
        else { await activity.end(using: state, dismissalPolicy: dismissal) }
    }

    func state(of activity: SystemActivity) -> Attributes.ContentState {
        if #available(iOS 16.2, *) { return activity.content.state }
        return activity.contentState
    }

    func lifecycle(of activity: SystemActivity) -> String {
        if #available(iOS 16.2, *), activity.activityState == .stale { return "stale" }
        switch activity.activityState {
        case .active: return "active"
        case .ended: return "ended"
        case .dismissed: return "dismissed"
        default: return "unknown"
        }
    }

    private func find(_ id: String) throws -> SystemActivity {
        guard let activity = SystemActivity.activities.first(where: { $0.attributes.instanceID == id }) else {
            throw ActivityFailure("NOT_FOUND", "The activity is no longer available.")
        }
        return activity
    }

    @available(iOS 16.2, *)
    private func content(_ state: Attributes.ContentState) -> ActivityContent<Attributes.ContentState> {
        ActivityContent(state: state, staleDate: state.staleAt.map { Date(timeIntervalSince1970: Double($0) / 1000) })
    }

    private func requireLegacyState(_ state: Attributes.ContentState) throws {
        if state.staleAt != nil {
            throw ActivityFailure("UNSUPPORTED_FEATURE", "staleAt requires iOS 16.2 or later.")
        }
    }

    private func mapAuthorizationError(_ error: ActivityAuthorizationError) -> ActivityFailure {
        switch error {
        case .attributesTooLarge: return ActivityFailure("PAYLOAD_TOO_LARGE", "ActivityKit rejected the payload size.")
        case .denied: return ActivityFailure("PERMISSION_DENIED", "Live Activities are disabled.")
        case .globalMaximumExceeded, .targetMaximumExceeded: return ActivityFailure("SYSTEM_LIMIT", "The system Live Activity limit was reached.")
        case .unsupported, .unsupportedTarget: return ActivityFailure("UNSUPPORTED_FEATURE", "Live Activities are unavailable on this device.")
        case .unentitled, .visibility: return ActivityFailure("CONFIGURATION_REQUIRED", "Check host app Live Activity configuration and foreground state.")
        default: return ActivityFailure("NATIVE_ERROR", "ActivityKit could not authorize the activity.")
        }
    }
}
