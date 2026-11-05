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
        GeometryReader { geometry in
            let transform = CGAffineTransform(scaleX: geometry.size.width / 100, y: geometry.size.height / 90)
            ZStack(alignment: .topLeading) {
                head.applying(transform).fill(MochiColors.fur)
                head.applying(transform)
                    .stroke(MochiColors.ink, style: StrokeStyle(lineWidth: 1.5, lineJoin: .round))
                if sleeping {
                    sleepingEyes.applying(transform)
                        .stroke(MochiColors.ink, style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
                } else {
                    Path { path in
                        path.addEllipse(in: CGRect(x: 30.8, y: 51.7, width: 4.4, height: 6.6))
                        path.addEllipse(in: CGRect(x: 64.8, y: 51.7, width: 4.4, height: 6.6))
                    }.applying(transform).fill(MochiColors.ink)
                }
                Path(ellipseIn: CGRect(x: 48.2, y: 62.8, width: 3.6, height: 2.4))
                    .applying(transform).fill(MochiColors.coral)
            }
        }
        .frame(width: 86, height: 77.4)
        .accessibilityHidden(true)
    }

    // The same 100×90 face path is used in the demo's SVG illustration.
    private var head: Path {
        Path { path in
            path.move(to: CGPoint(x: 14, y: 40))
            path.addCurve(to: CGPoint(x: 14, y: 14), control1: CGPoint(x: 12, y: 32), control2: CGPoint(x: 11, y: 22))
            path.addQuadCurve(to: CGPoint(x: 18, y: 13), control: CGPoint(x: 15, y: 11))
            path.addLine(to: CGPoint(x: 35, y: 27))
            path.addQuadCurve(to: CGPoint(x: 65, y: 27), control: CGPoint(x: 50, y: 23))
            path.addLine(to: CGPoint(x: 82, y: 13))
            path.addQuadCurve(to: CGPoint(x: 86, y: 14), control: CGPoint(x: 85, y: 11))
            path.addCurve(to: CGPoint(x: 86, y: 40), control1: CGPoint(x: 89, y: 22), control2: CGPoint(x: 88, y: 32))
            path.addCurve(to: CGPoint(x: 87, y: 71), control1: CGPoint(x: 93, y: 48), control2: CGPoint(x: 94, y: 61))
            path.addCurve(to: CGPoint(x: 50, y: 85), control1: CGPoint(x: 79, y: 81), control2: CGPoint(x: 66, y: 85))
            path.addCurve(to: CGPoint(x: 13, y: 71), control1: CGPoint(x: 34, y: 85), control2: CGPoint(x: 21, y: 81))
            path.addCurve(to: CGPoint(x: 14, y: 40), control1: CGPoint(x: 6, y: 61), control2: CGPoint(x: 7, y: 48))
            path.closeSubpath()
        }
    }

    private var sleepingEyes: Path {
        Path { path in
            path.move(to: CGPoint(x: 28, y: 54))
            path.addQuadCurve(to: CGPoint(x: 38, y: 54), control: CGPoint(x: 33, y: 58))
            path.move(to: CGPoint(x: 62, y: 54))
            path.addQuadCurve(to: CGPoint(x: 72, y: 54), control: CGPoint(x: 67, y: 58))
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
struct MochiWidgetBundle: WidgetBundle {
    var body: some Widget { MochiWidget() }
}
