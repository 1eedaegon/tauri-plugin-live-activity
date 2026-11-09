import ActivityKitWidget
import SwiftUI
import WidgetKit

// The demo's widget extension: activitykit's layout widget, as its templates/ios/Widget.swift writes it. The progress and
// timer templates of contract v1 are layouts too on iOS now, so this one widget draws every activity of the demo.
// examples/demo/tests/setup.test.mjs checks it against activitykit's template.
@main
struct Widgets: WidgetBundle {
    var body: some Widget {
        ActivityKitLayoutWidget()
    }
}
