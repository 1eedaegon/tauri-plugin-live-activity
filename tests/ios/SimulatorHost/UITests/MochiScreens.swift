import XCTest

final class MochiScreens: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "io.github.eedaegon.liveactivitydemo")

    private func button(_ prefix: String) -> XCUIElement {
        app.webViews.buttons.containing(NSPredicate(format: "label BEGINSWITH %@", prefix)).firstMatch
    }

    private func capture(_ name: String) throws {
        let file = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent(name + ".png")
        try XCUIScreen.main.screenshot().pngRepresentation.write(to: file, options: .atomic)
    }

    private func dismissEndedFixture(_ springboard: XCUIApplication) {
        let fixture = springboard.staticTexts["Mochi snack"].firstMatch
        guard fixture.exists else { return }
        fixture.swipeLeft()
        let clear = springboard.buttons["Clear"].firstMatch
        if clear.waitForExistence(timeout: 2) { clear.tap() }
        let gone = XCTNSPredicateExpectation(predicate: NSPredicate(format: "exists == false"), object: fixture)
        XCTAssertEqual(XCTWaiter.wait(for: [gone], timeout: 5), .completed)
    }

    func testActualMochiScreens() throws {
        app.launch()
        let start = button("Start snack delivery")
        XCTAssertTrue(start.waitForExistence(timeout: 20))
        start.tap()
        let advance = button("Send it on its way")
        XCTAssertTrue(advance.waitForExistence(timeout: 10))
        advance.tap()
        XCTAssertTrue(button("The snack is here!").waitForExistence(timeout: 10))
        try capture("mochi-demo")

        XCUIDevice.shared.press(.home)
        let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
        let island = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.025))
        island.press(forDuration: 1.5)
        Thread.sleep(forTimeInterval: 1)
        try capture("mochi-ios-dynamic-island")

        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        app.webViews.switches["Nap timer"].tap()
        let nap = button("Start a little nap")
        // Device Hub may drop the first WebView tap during the app's return animation.
        if !nap.waitForExistence(timeout: 2) { app.webViews.switches["Nap timer"].tap() }
        XCTAssertTrue(nap.waitForExistence(timeout: 10))
        nap.tap()
        XCTAssertTrue(button("Wake up, sleepyhead").waitForExistence(timeout: 10))
        let top = app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.01))
        let bottom = app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.85))
        top.press(forDuration: 0.1, thenDragTo: bottom)
        // The registry default-dismissal test may leave its ended fixture visible.
        dismissEndedFixture(springboard)
        XCTAssertTrue(springboard.staticTexts["Mochi’s snack delivery"].waitForExistence(timeout: 10))
        if !springboard.staticTexts["Mochi’s nap"].exists {
            springboard.staticTexts["Mochi’s snack delivery"].tap()
        }
        for _ in 0..<3 {
            for label in ["Always Allow", "Allow"] {
                let control = springboard.buttons[label].firstMatch
                if control.exists { control.tap() }
            }
        }
        XCTAssertTrue(springboard.staticTexts["Mochi’s nap"].waitForExistence(timeout: 10))
        try capture("mochi-ios-live-activity")
    }

}
