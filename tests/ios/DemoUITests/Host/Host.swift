import SwiftUI

/// The app that the UI testing bundle runs beside; the tests drive the demo app.
@main
struct Host: App {
    var body: some Scene {
        WindowGroup { Text("Demo UI tests") }
    }
}
