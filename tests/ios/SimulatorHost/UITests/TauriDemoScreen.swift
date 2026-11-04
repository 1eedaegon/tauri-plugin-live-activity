import XCTest

final class TauriDemoScreen: XCTestCase {
    func testLifecycleThroughTauri() {
        let app = XCUIApplication(bundleIdentifier: "io.github.eedaegon.liveactivitydemo")
        app.launch()
        let run = app.webViews.buttons["Run lifecycle test"].firstMatch
        XCTAssertTrue(run.waitForExistence(timeout: 20))
        app.swipeUp()
        app.swipeUp()
        run.tap()
        let passed = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "Integration test: passed.")).firstMatch
        XCTAssertTrue(passed.waitForExistence(timeout: 30))
    }

    func testShowActualExample() {
        let app = XCUIApplication(bundleIdentifier: "io.github.eedaegon.liveactivitydemo")
        app.launch()
        let start = app.webViews.buttons["Start activity"].firstMatch
        XCTAssertTrue(start.waitForExistence(timeout: 20))
        app.swipeDown()
        app.swipeDown()
        app.swipeDown()
        app.swipeDown()
        start.tap()
        let accepted = app.staticTexts["The OS accepted the activity. Check the notification area or Lock Screen."].firstMatch
        XCTAssertTrue(accepted.waitForExistence(timeout: 15))
        let top = app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.01))
        let bottom = app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.8))
        top.press(forDuration: 0.1, thenDragTo: bottom)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        XCTAssertTrue(springboard.staticTexts["Preparing your order"].waitForExistence(timeout: 10))
        for label in ["Always Allow", "Allow"] {
            let button = springboard.buttons[label].firstMatch
            if button.exists { button.tap() }
        }
        XCTAssertTrue(springboard.staticTexts["Preparing your order"].exists)
    }
}
