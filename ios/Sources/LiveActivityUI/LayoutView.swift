import SwiftUI
import LiveActivityShared

/// Draws one region of a layout activity: the layout's own tree, or the default of an absent island part.
@available(iOS 16.1, *)
public struct LayoutView: View {
    /// Wraps the label of a button node in the host's button, for example `Button(intent:)`, so the package
    /// never names an intent type. Without a builder, or below iOS 17, a button shows its label only.
    public typealias ButtonBuilder = (_ actionId: String, _ label: AnyView) -> AnyView

    private let node: LayoutRenderNode?
    private let button: ButtonBuilder?

    public init(document: LayoutDocument, values: [String: LayoutValue], region: LayoutRegion, button: ButtonBuilder? = nil) {
        node = document.render(region, values: values)
        self.button = button
    }

    public var body: some View {
        if let node { LayoutNodeView(node: node, button: button) }
    }
}

/// One resolved node and its subtree.
@available(iOS 16.1, *)
struct LayoutNodeView: View {
    let node: LayoutRenderNode
    let button: LayoutView.ButtonBuilder?

    var body: some View {
        content.layoutStyle(node.style)
    }

    @ViewBuilder private var content: some View {
        switch node.content {
        case let .vstack(children, spacing, alignment):
            VStack(alignment: alignment.horizontal, spacing: spacing.map { CGFloat($0) }) { stack(children) }
        case let .hstack(children, spacing, alignment):
            HStack(alignment: alignment.vertical, spacing: spacing.map { CGFloat($0) }) { stack(children) }
        case let .zstack(children, alignment):
            ZStack(alignment: alignment.alignment) { stack(children) }
        case .spacer(let minLength):
            Spacer(minLength: minLength.map { CGFloat($0) })
        case .divider:
            Divider()
        case .text(let text):
            Text(verbatim: text)
        case let .symbol(name, rendering, variableValue):
            Image(systemName: name, variableValue: variableValue).symbolRenderingMode(rendering?.mode)
        case let .image(asset, resizable, contentMode):
            LayoutAssetImage(asset: asset, resizable: resizable, contentMode: contentMode)
        case let .path(commands, width, height, stroke):
            LayoutPathView(commands: commands, box: CGSize(width: width, height: height), stroke: stroke)
        case let .progress(value, kind):
            if kind == .circular { ProgressView(value: value).progressViewStyle(.circular) }
            else { ProgressView(value: value).progressViewStyle(.linear) }
        case let .gauge(value, range, kind):
            if kind == .circular { Gauge(value: value, in: range) { EmptyView() }.gaugeStyle(.accessoryCircularCapacity) }
            else { Gauge(value: value, in: range) { EmptyView() }.gaugeStyle(.accessoryLinearCapacity) }
        case let .timer(interval, countsDown):
            Text(timerInterval: interval, countsDown: countsDown)
        case let .button(actionId, label):
            wrap(label, as: actionId)
        }
    }

    private func stack(_ children: [LayoutRenderNode]) -> some View {
        ForEach(children.indices, id: \.self) { LayoutNodeView(node: children[$0], button: button) }
    }

    private func wrap(_ label: LayoutRenderNode, as actionId: String) -> AnyView {
        let view = AnyView(LayoutNodeView(node: label, button: nil))
        if #available(iOS 17.0, *), let button { return button(actionId, view) }
        return view
    }
}
