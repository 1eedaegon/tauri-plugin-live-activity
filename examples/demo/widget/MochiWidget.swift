import ActivityKit
import SwiftUI
import WidgetKit
import LiveActivityShared

private enum MochiColors {
    static let background = Color(red: 0.980, green: 0.969, blue: 0.937)
    static let ink = Color(red: 0.247, green: 0.267, blue: 0.220)
    static let muted = Color(red: 0.416, green: 0.427, blue: 0.376)
    static let coral = Color(red: 0.788, green: 0.396, blue: 0.302)
    static let teal = Color(red: 0.157, green: 0.427, blue: 0.376)
    static let fur = Color(red: 0.965, green: 0.914, blue: 0.804)
    static let islandMint = Color(red: 0.64, green: 0.85, blue: 0.76)
}

@available(iOS 16.1, *)
struct MochiWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: LiveActivityAttributes.self) { context in
            MochiLockScreen(snapshot: context.state)
                .activityBackgroundTint(MochiColors.background)
                .activitySystemActionForegroundColor(MochiColors.teal)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.center) {
                    MochiIsland(snapshot: context.state)
                }
            } compactLeading: {
                Image(systemName: context.state.timer == nil ? "pawprint.fill" : "moon.fill")
                    .foregroundStyle(MochiColors.islandMint)
                    .accessibilityLabel(context.state.title)
            } compactTrailing: {
                MochiValue(snapshot: context.state, maxTimerWidth: 65)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(MochiColors.islandMint)
            } minimal: {
                Image(systemName: context.state.timer == nil ? "pawprint.fill" : "moon.fill")
                    .foregroundStyle(MochiColors.islandMint)
                    .accessibilityLabel(context.state.title)
            }
        }
    }
}

@available(iOS 16.1, *)
private struct MochiLockScreen: View {
    let snapshot: ActivitySnapshot

    var body: some View {
        HStack(spacing: 12) {
            MochiFace(sleeping: snapshot.timer != nil)
            VStack(alignment: .leading, spacing: 7) {
                Text(snapshot.title)
                    .font(.system(.headline, design: .rounded))
                    .foregroundStyle(MochiColors.ink)
                    .lineLimit(1)
                Text(snapshot.status)
                    .font(.subheadline)
                    .foregroundStyle(MochiColors.muted)
                    .lineLimit(2)
                HStack(spacing: 10) {
                    if let progress = snapshot.progress {
                        ProgressView(value: progress)
                            .tint(MochiColors.teal)
                            .accessibilityLabel("Snack delivery progress")
                    }
                    MochiValue(snapshot: snapshot)
                        .font(.system(snapshot.timer == nil ? .caption : .title2, design: .rounded).weight(.semibold))
                        .foregroundStyle(MochiColors.teal)
                }
            }
        }
        .padding(16)
    }
}

@available(iOS 16.1, *)
private struct MochiIsland: View {
    let snapshot: ActivitySnapshot

    var body: some View {
        HStack(spacing: 10) {
            MochiFace(sleeping: snapshot.timer != nil)
                .scaleEffect(0.72)
                .frame(width: 66, height: 62)
            VStack(alignment: .leading, spacing: 5) {
                Text(snapshot.title).font(.headline).foregroundStyle(.white).lineLimit(1)
                Text(snapshot.status).font(.caption).foregroundStyle(.white.opacity(0.75)).lineLimit(2)
                HStack(spacing: 10) {
                    if let progress = snapshot.progress {
                        ProgressView(value: progress).tint(MochiColors.islandMint)
                    }
                    MochiValue(snapshot: snapshot)
                        .font(.caption.monospacedDigit())
                        .foregroundStyle(MochiColors.islandMint)
                }
            }
        }
        .padding(.horizontal, 8)
        .padding(.bottom, 8)
    }
}

@available(iOS 16.1, *)
private struct MochiValue: View {
    let snapshot: ActivitySnapshot
    var maxTimerWidth: CGFloat = 110

    var body: some View {
        if let progress = snapshot.progress {
            Text(progress, format: .percent.precision(.fractionLength(0)))
                .monospacedDigit().fixedSize()
        } else if let timer = snapshot.timer {
            Text(timerInterval: timer.interval, countsDown: true)
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .frame(maxWidth: maxTimerWidth, alignment: .leading)
                .accessibilityLabel("Nap time remaining")
        }
    }
}

private struct MochiFace: View {
    let sleeping: Bool

    var body: some View {
        ZStack {
            ear.rotationEffect(.degrees(-18)).offset(x: -23, y: -21)
            ear.rotationEffect(.degrees(18)).offset(x: 23, y: -21)
            RoundedRectangle(cornerRadius: 25)
                .fill(MochiColors.fur)
                .overlay(RoundedRectangle(cornerRadius: 25).stroke(MochiColors.ink, lineWidth: 2))
                .frame(width: 72, height: 60)
            HStack(spacing: 23) {
                eye.rotationEffect(.degrees(sleeping ? -12 : 0))
                eye.rotationEffect(.degrees(sleeping ? 12 : 0))
            }
            .offset(y: -4)
            HStack(spacing: 36) {
                Ellipse().fill(MochiColors.coral.opacity(0.32))
                Ellipse().fill(MochiColors.coral.opacity(0.32))
            }
            .frame(width: 60, height: 6).offset(y: 7)
            Image(systemName: "heart.fill")
                .font(.system(size: 7)).foregroundStyle(MochiColors.coral).offset(y: 6)
            Text("ω").font(.system(size: 19, weight: .medium, design: .rounded))
                .foregroundStyle(MochiColors.ink).offset(y: 13)
        }
        .frame(width: 86, height: 80)
        .accessibilityHidden(true)
    }

    private var ear: some View {
        RoundedRectangle(cornerRadius: 7)
            .fill(MochiColors.fur)
            .overlay(RoundedRectangle(cornerRadius: 7).stroke(MochiColors.ink, lineWidth: 2))
            .frame(width: 25, height: 30)
    }

    private var eye: some View {
        Capsule().fill(MochiColors.ink).frame(width: sleeping ? 9 : 4, height: sleeping ? 2 : 5)
    }
}

private extension ActivityTimer {
    var interval: ClosedRange<Date> {
        Date(timeIntervalSince1970: Double(startedAt) / 1000)...Date(timeIntervalSince1970: Double(endsAt) / 1000)
    }
}

@main
@available(iOS 16.1, *)
struct MochiWidgetBundle: WidgetBundle {
    var body: some Widget { MochiWidget() }
}
