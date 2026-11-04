import XCTest

final class PermissionScreen: XCTestCase {
    func testShowDownloadOnLockScreen() {
        let app = XCUIApplication(bundleIdentifier: "io.github.eedaegon.LiveActivityNativeTests")
        app.terminate()
        app.launch()
        XCTAssertTrue(app.staticTexts["Activity updated; inspect Lock Screen"].waitForExistence(timeout: 15))
        let top = app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.01))
        let bottom = app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.8))
        top.press(forDuration: 0.1, thenDragTo: bottom)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        XCTAssertTrue(springboard.staticTexts["Downloading files"].waitForExistence(timeout: 10))
    }

    func testAllowLiveActivity() throws {
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let allow = springboard.buttons["Allow"].firstMatch
        guard allow.waitForExistence(timeout: 2) else { throw XCTSkip("No first-use permission prompt is pending.") }
        allow.tap()
    }
}
