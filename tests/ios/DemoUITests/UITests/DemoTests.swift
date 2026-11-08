import XCTest

/// The demo app on the Lock Screen, through Tauri, the plugin and activitykit. The methods run in the order of their
/// names. Each test ends what it started, so that no activity covers the next test's card on the Lock Screen.
final class DemoTests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "io.github.eedaegon.liveactivitydemo")
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")

    override func setUp() {
        continueAfterFailure = false
    }

    /// A button of the page; one with `aria-pressed`, like the mode and example chips, is a switch to WebKit.
    private func web(_ label: String) -> XCUIElement {
        let kinds = [XCUIElement.ElementType.button.rawValue, XCUIElement.ElementType.switch.rawValue]
        let match = NSPredicate(format: "elementType IN %@ AND label BEGINSWITH %@", kinds, label)
        return app.webViews.descendants(matching: .any).matching(match).firstMatch
    }

    private func webText(_ prefix: String) -> XCUIElement {
        app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", prefix)).firstMatch
    }

    private func tap(_ label: String, timeout: TimeInterval = 20) {
        let button = web(label)
        XCTAssertTrue(button.waitForExistence(timeout: timeout), "no button \(label)")
        for _ in 0..<6 where !button.isHittable { app.swipeUp() }
        button.tap()
    }

    /// The system asks once whether the app may show Live Activities.
    private func allow() {
        for label in ["Always Allow", "Allow"] {
            let control = springboard.buttons[label].firstMatch
            if control.waitForExistence(timeout: 2) { control.tap() }
        }
    }

    private func capture(_ name: String) {
        let shot = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        shot.name = name
        shot.lifetime = .keepAlways
        add(shot)
    }

    private func openLayouts(_ example: String) {
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        tap("Layouts")
        tap(example)
    }

    /// Pulls the Lock Screen over the app, from a fixed point at the top of the screen.
    private func pullLockScreen() {
        let top = app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.01))
        let bottom = app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.8))
        top.press(forDuration: 0.1, thenDragTo: bottom)
    }

    private func leaveLockScreen() {
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
    }

    // TP-E2E-1, TP-IOS-1, TP-IOS-3
    func test1BoundStyleShowsOnTheLockScreen() {
        app.launch()
        openLayouts("Changing styles")
        tap("Start this example")
        allow()
        XCTAssertTrue(webText("is on its way to your phone").waitForExistence(timeout: 20))
        tap("Send new values")
        XCTAssertTrue(webText("New values sent at revision 1").waitForExistence(timeout: 20))
        pullLockScreen()
        XCTAssertTrue(springboard.staticTexts["Running 5 min late"].waitForExistence(timeout: 15))
        capture("e2e-1-bound-style-lock-screen")
        // The system asks on the Lock Screen card whether the app may keep showing Live Activities.
        allow()
        leaveLockScreen()
        tap("End this example")
        XCTAssertTrue(webText("has ended").waitForExistence(timeout: 20))
    }

    // TP-E2E-2, TP-ACTION-1
    func test2LockScreenButtonReachesRustAndJavaScript() {
        app.launch()
        openLayouts("Buttons")
        tap("Start this example")
        XCTAssertTrue(webText("is on its way to your phone").waitForExistence(timeout: 20))
        pullLockScreen()
        let pet = springboard.buttons["Pet Mochi"].firstMatch
        XCTAssertTrue(pet.waitForExistence(timeout: 15))
        capture("e2e-2-buttons-before")
        pet.tap()
        // Rust's on_action handler (examples/demo/src-tauri/src/actions.rs) counts the pet with an update.
        XCTAssertTrue(springboard.staticTexts["Purring. 1 pet so far"].waitForExistence(timeout: 20))
        capture("e2e-2-buttons-after-rust")
        leaveLockScreen()
        // The page's onAction listener shows the tap, in its message and under Developer tools.
        XCTAssertTrue(webText("Mochi felt “pet”").waitForExistence(timeout: 20))
        tap("Developer tools")
        XCTAssertTrue(webText("Last tap: {\"actionId\":\"pet\"").waitForExistence(timeout: 10))
        capture("e2e-2-tap-in-javascript")
    }

    // TP-E2E-3, TP-IOS-6
    func test3ListAfterARelaunchFindsTheActivity() {
        app.terminate()
        app.launch()
        openLayouts("Buttons")
        // listLayout at launch found the running activity: the page offers to end it, at the revision Rust sent.
        XCTAssertTrue(web("End this example").waitForExistence(timeout: 20))
        XCTAssertTrue(webText("ON YOUR PHONE NOW").waitForExistence(timeout: 5))
        tap("Developer tools")
        XCTAssertTrue(webText("Purring. 1 pet so far").waitForExistence(timeout: 10))
        capture("e2e-3-listed-after-relaunch")
        tap("End this example")
        XCTAssertTrue(webText("has ended").waitForExistence(timeout: 20))
    }

    // TP-E2E-4, TP-IOS-2, TP-IOS-3, TP-IOS-5, TP-V1-2
    func test4LifecycleChecksPassThroughTauri() {
        app.launch()
        tap("Developer tools")
        tap("Run lifecycle test")
        XCTAssertTrue(webText("Integration test: passed.").waitForExistence(timeout: 60), app.debugDescription)
        capture("e2e-4-lifecycle-passed")
    }

    // TP-V1-1
    func test5TemplatesShowOnTheLockScreenAsLayouts() {
        app.launch()
        tap("Snack delivery")
        tap("Start snack delivery")
        pullLockScreen()
        XCTAssertTrue(springboard.staticTexts["Mochi’s snack delivery"].waitForExistence(timeout: 15))
        allow()
        XCTAssertTrue(springboard.staticTexts["Mochi’s snack delivery"].waitForExistence(timeout: 5))
        capture("e2e-5-v1-progress")
        leaveLockScreen()
        tap("Finish delivery")
        tap("Nap timer")
        tap("Start a little nap")
        pullLockScreen()
        XCTAssertTrue(springboard.staticTexts["Mochi’s nap"].waitForExistence(timeout: 15))
        capture("e2e-5-v1-timer")
        leaveLockScreen()
        tap("Wake up, sleepyhead")
        XCTAssertTrue(webText("Nap finished").waitForExistence(timeout: 20))
    }
}
