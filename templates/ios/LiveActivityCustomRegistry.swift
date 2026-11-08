import Foundation
import SwiftUI

// The plugin's side of `custom` layout nodes. Compile this file into both the host app target and the widget
// extension target, like LiveActivityActionIntent.swift; your views go in LiveActivityCustomViews.swift. It does not
// depend on the plugin's Swift package, so the app target compiles it without linking a package product.

/// The props of a `custom` node as its view gets them: literals as the layout wrote them, and bound props with the value
/// of the current update. A prop that the node does not set is absent.
@available(iOS 16.1, *)
struct LiveActivityCustomProps {
    enum Value: Equatable {
        case string(String)
        case number(Double)
        case bool(Bool)
    }

    let values: [String: Value]

    subscript(key: String) -> Value? { values[key] }

    func string(_ key: String) -> String? {
        if case .string(let text)? = values[key] { return text } else { return nil }
    }

    func number(_ key: String) -> Double? {
        if case .number(let number)? = values[key] { return number } else { return nil }
    }

    func bool(_ key: String) -> Bool? {
        if case .bool(let flag)? = values[key] { return flag } else { return nil }
    }
}

/// One registered view: what it draws for the props of its node.
@available(iOS 16.1, *)
struct LiveActivityCustomView {
    let make: (LiveActivityCustomProps) -> AnyView

    init<Content: View>(@ViewBuilder _ make: @escaping (LiveActivityCustomProps) -> Content) {
        self.make = { AnyView(make($0)) }
    }
}

/// The base of the registry in LiveActivityCustomViews.swift. The widget finds that subclass by its Objective-C name to draw
/// a `custom` node; the plugin finds it in the app to report a name without a view in `degradedFeatures` as
/// `layout.custom.<name>`. Without the subclass, every custom node draws nothing.
@available(iOS 16.1, *)
class LiveActivityCustomViewRegistry: NSObject {
    /// The views by the `name` of their nodes. LiveActivityCustomViews overrides it.
    class var views: [String: LiveActivityCustomView] { [:] }

    /// The registered names, for the plugin in the app process.
    @objc class var viewNames: [String] { views.keys.sorted() }

    /// The subclass of LiveActivityCustomViews.swift, when the target compiles it.
    static var registered: LiveActivityCustomViewRegistry.Type? {
        NSClassFromString("TauriLiveActivityCustomViews") as? LiveActivityCustomViewRegistry.Type
    }
}
