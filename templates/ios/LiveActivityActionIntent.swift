import AppIntents
import Foundation

/// The action of a layout `button` node. Compile this file into both the host app target and the widget
/// extension target. It does not depend on the plugin's Swift package: the plugin is already linked into the
/// app through the Rust static library.
@available(iOS 17.0, *)
struct LiveActivityActionIntent: LiveActivityIntent {
    static let title: LocalizedStringResource = "Live Activity action"
    static let isDiscoverable = false
    static var authenticationPolicy: IntentAuthenticationPolicy { .alwaysAllowed }

    @Parameter(title: "Activity") var activityId: String
    @Parameter(title: "Action") var actionId: String

    init() {}
    init(activityId: String, actionId: String) {
        self.activityId = activityId
        self.actionId = actionId
    }

    /// Runs in the app process. Hands the action to the plugin through `NotificationCenter` and posts again
    /// every 100 ms for up to 5 s until the plugin marks the acknowledgement, which it does once the app's
    /// Rust handlers have run for the tap. Waiting keeps an app that the system launched for this tap running
    /// meanwhile; the plugin ignores the repeated posts.
    func perform() async throws -> some IntentResult {
        let acknowledgement = Progress.discreteProgress(totalUnitCount: 1)
        let info: [AnyHashable: Any] = ["activityId": activityId, "actionId": actionId, "acknowledgement": acknowledgement]
        for _ in 0..<50 {
            NotificationCenter.default.post(name: Notification.Name("tauri.live-activity.action"), object: nil, userInfo: info)
            if acknowledgement.isFinished { break }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        return .result()
    }
}
