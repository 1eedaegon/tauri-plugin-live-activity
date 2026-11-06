import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit
import LiveActivityShared
import LiveActivityUI

// `LiveActivityLayoutWidget` from the plugin's templates/ios/LiveActivityWidget.swift, unchanged.
// The demo keeps its own v1 widget (MochiWidget.swift), so it takes the layout widget alone and
// adds it to its bundle. examples/demo/tests/setup.test.mjs checks that the copy matches.

/// Layout activities (request contract v2). Absent island parts show the defaults of the contract.
@available(iOS 16.1, *)
struct LiveActivityLayoutWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LiveActivityLayoutAttributes.self) { context in
            LayoutLockScreen(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) { LayoutRegionView(context: context, region: .expandedLeading) }
                DynamicIslandExpandedRegion(.trailing) { LayoutRegionView(context: context, region: .expandedTrailing) }
                DynamicIslandExpandedRegion(.center) { LayoutRegionView(context: context, region: .expandedCenter) }
                DynamicIslandExpandedRegion(.bottom) { LayoutRegionView(context: context, region: .expandedBottom) }
            } compactLeading: {
                LayoutRegionView(context: context, region: .compactLeading)
            } compactTrailing: {
                LayoutRegionView(context: context, region: .compactTrailing)
            } minimal: {
                LayoutRegionView(context: context, region: .minimal)
            }
            // The Dynamic Island is always dark.
            .keylineTint(context.attributes.document.keyline.map { Color($0, scheme: .dark) })
        }
    }
}

@available(iOS 16.1, *)
private struct LayoutLockScreen: View {
    @Environment(\.colorScheme) private var scheme
    let context: ActivityViewContext<LiveActivityLayoutAttributes>

    var body: some View {
        LayoutRegionView(context: context, region: .lockScreen)
            .activityBackgroundTint(context.attributes.document.background.map { Color($0, scheme: scheme) })
    }
}

@available(iOS 16.1, *)
private struct LayoutRegionView: View {
    let context: ActivityViewContext<LiveActivityLayoutAttributes>
    let region: LayoutRegion

    var body: some View {
        LayoutView(document: context.attributes.document, values: context.state.values, region: region, button: button)
    }

    /// Buttons run `LiveActivityActionIntent` (LiveActivityActionIntent.swift) in the app process.
    private var button: LayoutView.ButtonBuilder? {
        guard #available(iOS 17.0, *) else { return nil }
        let activityId = context.attributes.instanceID
        return { actionId, label in
            AnyView(Button(intent: LiveActivityActionIntent(activityId: activityId, actionId: actionId)) { label })
        }
    }
}
