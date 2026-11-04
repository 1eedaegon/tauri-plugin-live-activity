import ActivityKit
import SwiftUI
import WidgetKit
import LiveActivityShared

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

@main
@available(iOS 16.1, *)
struct LiveActivityWidgetBundle: WidgetBundle {
    var body: some Widget { LiveActivityWidget() }
}
