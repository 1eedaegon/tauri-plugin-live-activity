import XCTest

/// The demo app on the Lock Screen, through Tauri, the plugin and activitykit. The methods run in the order of their
/// names. Each test ends what it started, so that no activity covers the next test's card on the Lock Screen.
final class DemoTests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "io.github.eedaegon.liveactivitydemo")
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    /// How long the page may take: the first launch on a fresh simulator starts WebKit, which took over 20 s.
    private let pageLoad: TimeInterval = 90

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

    /// Launches the app anew and waits for its page.
    private func launch() {
        app.launch()
        XCTAssertTrue(web("Layouts").waitForExistence(timeout: pageLoad), "no page")
    }

    private func openLayouts(_ example: String) {
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 20))
        // A page that has just loaded can take a tap before its script listens: tap the tab until it opens.
        let opened = web(example)
        for _ in 0..<3 where !opened.exists {
            tap("Layouts")
            _ = opened.waitForExistence(timeout: 10)
        }
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

    // TP-E2E-1, TP-E2E-6, TP-IOS-1, TP-IOS-3
    func test1BoundStyleShowsOnTheLockScreen() {
        launch()
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

    // TP-E2E-2, TP-E2E-6, TP-ACTION-1
    func test2LockScreenButtonReachesRustAndJavaScript() {
        launch()
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
        // The Lock Screen draws the new content a moment after it reports it.
        XCTAssertTrue(springboard.staticTexts["No pets yet"].waitForNonExistence(timeout: 10))
        capture("e2e-2-buttons-after-rust")
        leaveLockScreen()
        // The page's onAction listener shows the tap, in its message and under Developer tools.
        XCTAssertTrue(webText("Mochi felt “pet”").waitForExistence(timeout: 20))
        tap("Developer tools")
        XCTAssertTrue(webText("Last tap: {\"actionId\":\"pet\"").waitForExistence(timeout: 10))
        capture("e2e-2-tap-in-javascript")
    }

    // TP-E2E-3, TP-E2E-6, TP-IOS-6
    func test3ListAfterARelaunchFindsTheActivity() {
        app.terminate()
        launch()
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
        launch()
        tap("Developer tools")
        tap("Run lifecycle test")
        XCTAssertTrue(webText("Integration test: passed.").waitForExistence(timeout: 60), app.debugDescription)
        capture("e2e-4-lifecycle-passed")
    }

    // TP-V1-1
    func test5TemplatesShowOnTheLockScreenAsLayouts() {
        launch()
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

    // TP-E2E-5, TP-ACTION-3
    func test6TapLaunchesTheAppForASlowRustHandler() {
        launch()
        openLayouts("Buttons")
        tap("Start this example")
        XCTAssertTrue(webText("is on its way to your phone").waitForExistence(timeout: 20))
        app.terminate()
        XCTAssertTrue(app.wait(for: .notRunning, timeout: 10))
        // The Lock Screen over the Home Screen: the system launches the app in the background for the tap.
        let top = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.01))
        top.press(forDuration: 0.1, thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.8)))
        let pet = springboard.buttons["Pet Mochi"].firstMatch
        XCTAssertTrue(pet.waitForExistence(timeout: 15))
        XCTAssertTrue(springboard.staticTexts["No pets yet"].exists)
        pet.tap()
        // The handler takes a second (COUNTING in examples/demo/src-tauri/src/actions.rs), then updates the activity.
        XCTAssertTrue(springboard.staticTexts["Purring. 1 pet so far"].waitForExistence(timeout: 20))
        XCTAssertTrue(springboard.staticTexts["No pets yet"].waitForNonExistence(timeout: 10))
        capture("e2e-6-background-tap-after-slow-handler")
        XCTAssertNotEqual(app.state, .runningForeground)
        XCUIDevice.shared.press(.home)
        launch()
        openLayouts("Buttons")
        tap("End this example")
        XCTAssertTrue(webText("has ended").waitForExistence(timeout: 20))
    }

    // TP-E2E-6
    /// Rust starts the Buttons example (`--start-buttons`), so the test needs no page: in the build of `tauri ios dev`
    /// the page comes from Tauri's server. The widget draws the layout and a tap reaches the Rust handler.
    func test7RustStartsALayoutWhoseButtonReachesRust() {
        app.terminate()
        app.launchArguments = ["--start-buttons"]
        app.launch()
        XCUIDevice.shared.press(.home)
        let top = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.01))
        top.press(forDuration: 0.1, thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.8)))
        let pet = springboard.buttons["Pet Mochi"].firstMatch
        XCTAssertTrue(pet.waitForExistence(timeout: 20))
        XCTAssertTrue(springboard.staticTexts["No pets yet"].exists)
        allow()
        pet.tap()
        XCTAssertTrue(springboard.staticTexts["Purring. 1 pet so far"].waitForExistence(timeout: 20))
        XCTAssertTrue(springboard.staticTexts["No pets yet"].waitForNonExistence(timeout: 10))
        capture("e2e-7-rust-start-and-button")
        springboard.buttons["All done"].firstMatch.tap()
        XCTAssertTrue(springboard.buttons["Pet Mochi"].waitForNonExistence(timeout: 20))
    }
}
