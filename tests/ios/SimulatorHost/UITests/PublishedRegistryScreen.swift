import XCTest

/// Drives an independently installed app built from exact npm/crates.io versions.
/// The runner's local harness is only the UI automation host.
final class PublishedRegistryScreen: XCTestCase {
    private func run(_ button: String, result: String, timeout: TimeInterval = 45) {
        let app = XCUIApplication(bundleIdentifier: "io.github.eedaegon.liveactivityregistrydemo")
        app.launch()
        let control = app.webViews.buttons[button].firstMatch
        XCTAssertTrue(control.waitForExistence(timeout: 20))
        for _ in 0..<3 { app.swipeUp() }
        control.tap()
        let completed = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", result)).firstMatch
        XCTAssertTrue(completed.waitForExistence(timeout: timeout))
    }

    func testLifecycle() {
        run("Run lifecycle test", result: "Integration test: passed.")
    }

    func testFeatures() {
        run("Run iOS feature checks", result: "iOS features: passed.", timeout: 65)
    }

    func testUnicodeRegression() {
        run("Run Unicode regression", result: "Unicode regression: passed.")
    }

}
