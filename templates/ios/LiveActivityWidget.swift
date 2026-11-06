import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit
import LiveActivityShared
import LiveActivityUI

@available(iOS 16.1, *)
struct LiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LiveActivityAttributes.self) { context in
            VStack(alignment: .leading, spacing: 8) {
                Text(context.state.title).font(.headline).lineLimit(1)
                Text(context.state.status).font(.subheadline).lineLimit(2)
                ActivityMeter(snapshot: context.state)
            }
            .padding()
            .activityBackgroundTint(Color(.secondarySystemBackground))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 6) {
                        Text(context.state.title).font(.headline).lineLimit(1)
                        Text(context.state.status).font(.caption).lineLimit(2)
                        ActivityMeter(snapshot: context.state)
                    }
                }
            } compactLeading: {
                Image(systemName: context.state.timer == nil ? "arrow.down.circle" : "timer")
                    .accessibilityLabel(context.state.title)
            } compactTrailing: {
                ActivityCompactValue(snapshot: context.state)
            } minimal: {
                if let progress = context.state.progress {
                    ProgressView(value: progress).progressViewStyle(.circular)
                } else {
                    Image(systemName: "timer")
                }
            }
        }
    }
}

@available(iOS 16.1, *)
private struct ActivityMeter: View {
    let snapshot: ActivitySnapshot
    var body: some View {
        if let progress = snapshot.progress {
            ProgressView(value: progress).accessibilityLabel("Progress")
        } else if let timer = snapshot.timer {
            Text(timerInterval: timer.interval, countsDown: true).monospacedDigit()
                .accessibilityLabel("Time remaining")
        }
    }
}

@available(iOS 16.1, *)
private struct ActivityCompactValue: View {
    let snapshot: ActivitySnapshot
    var body: some View {
        if let progress = snapshot.progress {
            Text(progress, format: .percent.precision(.fractionLength(0))).monospacedDigit()
        } else if let timer = snapshot.timer {
            Text(timerInterval: timer.interval, countsDown: true).monospacedDigit().frame(maxWidth: 60)
        }
    }
}

private extension ActivityTimer {
    var interval: ClosedRange<Date> {
        Date(timeIntervalSince1970: Double(startedAt) / 1000)...Date(timeIntervalSince1970: Double(endsAt) / 1000)
    }
}

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

@main
@available(iOS 16.1, *)
struct LiveActivityWidgetBundle: WidgetBundle {
    var body: some Widget {
        LiveActivityWidget()
        LiveActivityLayoutWidget()
    }
}
