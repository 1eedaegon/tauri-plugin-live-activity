import ActivityKitViews
import SwiftUI

// Your SwiftUI views for `custom` layout nodes. `npx tauri-plugin-live-activity setup` created this file once and never
// changes it. It is compiled into the widget extension, which draws the views, and into the app, so that activitykit can
// report a node whose name has no view here (`degradedFeatures`: `layout.custom.<name>`). Both targets link activitykit's
// `ActivityKitViews` product. Keep the Objective-C name: activitykit finds the views by it.
//
// A view gets the node's props: `props.number("level")`, `props.string("label")`, `props.bool("full")`. A prop bound to a
// value, `props: { level: bind('bowl') }`, has the value of the latest update. The node's style sets the frame, padding,
// colors and font around the view. A Live Activity has no network and little memory: draw with shapes, text and images
// of the extension; no timers, no animations of your own.

@available(iOS 16.1, *)
@objc(ActivityKitCustomViews)
final class LiveActivityCustomViews: ActivityKitCustomViewRegistry {
    override class var views: [String: ActivityKitCustomView] {
        [
            // The layout node `custom('ring', { props: { level: bind('bowl') } })` draws this ring:
            // "ring": ActivityKitCustomView { props in
            //     Circle().trim(from: 0, to: props.number("level") ?? 0).stroke(lineWidth: 4).rotationEffect(.degrees(-90))
            // },
        ]
    }
}
