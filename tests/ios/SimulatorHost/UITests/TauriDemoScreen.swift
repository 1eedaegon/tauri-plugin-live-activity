import XCTest

final class TauriDemoScreen: XCTestCase {
    func testLifecycleThroughTauri() {
        let app = XCUIApplication(bundleIdentifier: "io.github.eedaegon.liveactivitydemo")
        app.launch()
        let developerTools = app.webViews.buttons["Developer tools"].firstMatch
        XCTAssertTrue(developerTools.waitForExistence(timeout: 20))
        for _ in 0..<2 { app.swipeUp() }
        developerTools.tap()
        let run = app.webViews.buttons["Run lifecycle test"].firstMatch
        XCTAssertTrue(run.waitForExistence(timeout: 10))
        for _ in 0..<8 {
            if run.isHittable { break }
            app.swipeUp()
        }
        run.tap()
        let passed = app.staticTexts.containing(NSPredicate(format: "label BEGINSWITH %@", "Integration test: passed.")).firstMatch
        XCTAssertTrue(passed.waitForExistence(timeout: 30))
    }
}
