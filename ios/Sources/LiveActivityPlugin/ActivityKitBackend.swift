import ActivityKit
import Foundation
import UIKit
import LiveActivityShared
#if canImport(LiveActivityCore)
import LiveActivityCore
#endif

@available(iOS 16.1, *)
@MainActor
final class ActivityKitBackend: ActivityBackend {
    typealias SystemActivity = Activity<LiveActivityAttributes>

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

    func list() async -> [NativeActivity] {
        SystemActivity.activities.filter { $0.attributes.schemaVersion == 1 }.map(describe)
    }

    func start(_ attributes: LiveActivityAttributes, snapshot: ActivitySnapshot) async throws -> NativeActivity {
        do {
            let activity: SystemActivity
            if #available(iOS 16.2, *) {
                activity = try SystemActivity.request(attributes: attributes, content: content(snapshot), pushType: nil)
            } else {
                try requireLegacyState(snapshot)
                activity = try SystemActivity.request(attributes: attributes, contentState: snapshot, pushType: nil)
            }
            return describe(activity)
        } catch let failure as ActivityFailure { throw failure }
        catch let failure as ActivityAuthorizationError { throw mapAuthorizationError(failure) }
        catch { throw ActivityFailure("NATIVE_ERROR", "ActivityKit could not start the activity.") }
    }

    func update(_ previous: NativeActivity, snapshot: ActivitySnapshot) async throws -> NativeActivity {
        let activity = try find(previous.id)
        if #available(iOS 16.2, *) {
            await activity.update(content(snapshot))
        } else {
            try requireLegacyState(snapshot)
            await activity.update(using: snapshot)
        }
        return describe(activity)
    }

    func end(_ previous: NativeActivity, policy: EndPolicy) async throws -> NativeActivity {
        let activity = try find(previous.id)
        let dismissal: ActivityUIDismissalPolicy
        switch policy.kind {
        case "immediate": dismissal = .immediate
        case "after":
            guard let at = policy.at else { throw ActivityFailure("INVALID_INPUT", "A dismissal timestamp is required.") }
            dismissal = .after(Date(timeIntervalSince1970: Double(at) / 1000))
        default: dismissal = .default
        }
        if #available(iOS 16.2, *) { await activity.end(content(previous.snapshot), dismissalPolicy: dismissal) }
        else { await activity.end(using: previous.snapshot, dismissalPolicy: dismissal) }
        return NativeActivity(id: previous.id, attributes: previous.attributes, snapshot: previous.snapshot, state: "ended")
    }

    private func find(_ id: String) throws -> SystemActivity {
        guard let activity = SystemActivity.activities.first(where: { $0.attributes.instanceID == id }) else {
            throw ActivityFailure("NOT_FOUND", "The activity is no longer available.")
        }
        return activity
    }

    private func describe(_ activity: SystemActivity) -> NativeActivity {
        let snapshot: ActivitySnapshot
        if #available(iOS 16.2, *) { snapshot = activity.content.state }
        else { snapshot = activity.contentState }
        return NativeActivity(id: activity.attributes.instanceID, attributes: activity.attributes, snapshot: snapshot, state: state(activity))
    }

    private func state(_ activity: SystemActivity) -> String {
        if #available(iOS 16.2, *), activity.activityState == .stale { return "stale" }
        switch activity.activityState {
        case .active: return "active"
        case .ended: return "ended"
        case .dismissed: return "dismissed"
        default: return "unknown"
        }
    }

    @available(iOS 16.2, *)
    private func content(_ snapshot: ActivitySnapshot) -> ActivityContent<ActivitySnapshot> {
        ActivityContent(state: snapshot, staleDate: snapshot.staleAt.map { Date(timeIntervalSince1970: Double($0) / 1000) })
    }

    private func requireLegacyState(_ snapshot: ActivitySnapshot) throws {
        if snapshot.staleAt != nil {
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
