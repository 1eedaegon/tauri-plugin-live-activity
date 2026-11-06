import XCTest

/// Layout activities (request contract v2) in the native harness: every fixture through the plugin path and
/// the interpreter, the widget's texts on the Lock Screen, and a button tap that reaches the app.
final class LayoutScreen: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "io.github.eedaegon.LiveActivityNativeTests")
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

    private func launch(_ scenario: String) {
        app.terminate()
        app.launchArguments = ["-scenario", scenario]
        app.launch()
    }

    private func status(_ prefix: String) -> XCUIElement {
        app.staticTexts.matching(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    private var currentStatus: String { app.staticTexts["native-test-status"].label }

    private func capture(_ name: String) throws {
        let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent(name + ".png")
        try XCUIScreen.main.screenshot().pngRepresentation.write(to: file, options: .atomic)
    }

    /// Starts the activity and pulls the Lock Screen over the app until the updated texts show. The system
    /// asks once whether the app may show Live Activities; the test allows it, as the Mochi screens test does.
    private func showLayoutOnLockScreen() {
        XCUIDevice.shared.press(.home)
        launch("layout")
        XCTAssertTrue(app.staticTexts["Layout activity updated; inspect Lock Screen"].waitForExistence(timeout: 30), currentStatus)
        let top = app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.01))
        let bottom = app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.8))
        top.press(forDuration: 0.1, thenDragTo: bottom)
        XCTAssertTrue(springboard.staticTexts["Layout activity"].waitForExistence(timeout: 10))
        XCTAssertTrue(springboard.staticTexts["Step 2 of 3"].waitForExistence(timeout: 5))
        for label in ["Always Allow", "Allow"] {
            let control = springboard.buttons[label].firstMatch
            if control.exists { control.tap() }
        }
    }

    func testEveryFixtureThroughPluginAndInterpreter() {
        launch("fixtures")
        XCTAssertTrue(status("PASS: layout fixtures").waitForExistence(timeout: 600), currentStatus)
    }

    /// Reads the texts, taps Stop and waits for the app to receive the action and end the activity, so no
    /// activity is left to cover another test's card in the Lock Screen stack.
    func testLayoutButtonReachesApp() throws {
        showLayoutOnLockScreen()
        let stop = springboard.buttons["Stop"].firstMatch
        XCTAssertTrue(stop.waitForExistence(timeout: 5))
        try capture("plugin-v2-lockscreen")
        stop.tap()
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        XCTAssertTrue(status("PASS: layout").waitForExistence(timeout: 30), currentStatus)
    }
}
