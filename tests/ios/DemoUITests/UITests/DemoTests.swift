import XCTest

/// The demo app on the Lock Screen, through Tauri, the plugin and activitykit. The methods run in the order of their
/// names. Each test ends what it started, so that no activity covers the next test's card on the Lock Screen. A test
/// that failed has not: the next start of that example ends on the page what is left (`openStopped`).
final class DemoTests: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "io.github.eedaegon.liveactivitydemo")
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    /// How long the page may take: the first launch on a fresh simulator starts WebKit, which took over 20 s.
    private let pageLoad: TimeInterval = 90
    /// How long the page may take to answer a tap, and the system (the Lock Screen, an app's state) to show a change.
    /// A shared Intel runner is slower than a Mac at hand.
    private let page: TimeInterval = 30
    private let system: TimeInterval = 30
    /// How long a Lock Screen tap may take to come back as an update: the intent wakes the app, Rust's handler updates
    /// the activity and the Lock Screen redraws. A debug build (`tauri ios dev`) on a shared runner took over 30 s.
    private let reaction: TimeInterval = 90
    /// How long the Lock Screen may take to draw content that it already reports.
    private let redraw: TimeInterval = 15
    /// How long the demo's lifecycle test may take: its checks go through Tauri and activitykit.
    private let selfTest: TimeInterval = 120
    /// How long to look for the system's question about Live Activities: it comes under an app's first card
    /// ("Allow"), again under its second ("Always Allow"), and was not seen after.
    private let prompt: TimeInterval = 2
    /// How long a tab may take to open before the tab is tapped again.
    private let retry: TimeInterval = 10
    /// How long the Lock Screen may take to turn to stale content: the Staleness example is stale after 45 s
    /// (`freshFor` in examples/demo/src/layouts.ts), and the system draws it some time after that.
    private let staleness: TimeInterval = 180
    /// How far ahead the Scheduled start example begins (`startsIn` in examples/demo/src/layouts.ts), and how long the
    /// system may take to begin it and draw it from then.
    private let startsIn: TimeInterval = 30
    private let beginning: TimeInterval = 120

    /// Whether a test of this run has failed. A test stops at its first failure, before it ends what it started.
    private static var failed = false
    /// The time of day in the name of a failure's screenshot: a test that runs again can fail again.
    private static let clock: DateFormatter = {
        let clock = DateFormatter()
        clock.locale = Locale(identifier: "en_US_POSIX")
        clock.dateFormat = "HHmmss"
        return clock
    }()

    override func setUp() {
        continueAfterFailure = false
    }

    /// After a failure, the screen as it is: a card that the Lock Screen shows without its content has nothing in the
    /// accessibility tree, which is all that a failed look says otherwise.
    override func tearDown() {
        // The count of failures so far: `hasSucceeded` is false of every test here, where its run has not ended.
        guard let run = testRun, run.totalFailureCount > 0 else { return }
        Self.failed = true
        let test = name.split(separator: " ").last.map { String($0.dropLast()) } ?? name
        capture("e2e-failed-\(test)-\(Self.clock.string(from: Date()))")
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

    private func tap(_ label: String) {
        let button = web(label)
        XCTAssertTrue(button.waitForExistence(timeout: page), "no button \(label)")
        for _ in 0..<6 where !button.isHittable { app.swipeUp() }
        button.tap()
    }

    /// The system asks under an app's first card whether it may show Live Activities, and under its second whether
    /// it may go on showing them.
    private func allow() {
        for label in ["Always Allow", "Allow"] {
            let control = springboard.buttons[label].firstMatch
            if control.waitForExistence(timeout: prompt) { control.tap() }
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
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: system))
        // A page that has just loaded can take a tap before its script listens: tap the tab until it opens.
        let opened = web(example)
        for _ in 0..<3 where !opened.exists {
            tap("Layouts")
            _ = opened.waitForExistence(timeout: retry)
        }
        tap(example)
    }

    /// Which of two lines the page shows within `timeout`, read at one look: true for `running`, false for `stopped`,
    /// nil while it shows neither.
    private func says(_ running: XCUIElement, or stopped: XCUIElement, within timeout: TimeInterval) -> Bool? {
        var answer: Bool?
        _ = holds(within: timeout) {
            answer = running.exists ? true : stopped.exists ? false : nil
            return answer != nil
        }
        return answer
    }

    /// Opens the example for a start: one that an earlier attempt of a test left running is ended first. The page
    /// lists a running activity at launch and says so when its example opens, and it offers then to end it and not to
    /// start it. The Lock Screen is not asked: the card of such an activity can be one that the system shows without
    /// its content (seen on shared runners), which has no button to end it with.
    private func openStopped(_ example: String) {
        openLayouts(example)
        let left = webText("\(example) is already on your phone")
        let stopped = webText("\(example): start it to see it on your phone")
        // The page answers the tap that opens an example with one of the two lines. A tap that it did not take, as
        // while it is busy, is given again.
        var runs = says(left, or: stopped, within: retry)
        for _ in 0..<2 where runs == nil {
            tap(example)
            runs = says(left, or: stopped, within: retry)
        }
        guard let runs else { return XCTFail("the page does not say whether \(example) runs") }
        if runs { endExample() }
    }

    /// Opens a tab of the page's two templates for a start, as `openStopped` an example: the page says there whether
    /// the template's activity runs, and offers `end` for one that an earlier attempt left.
    private func openStoppedTemplate(_ tab: String, endedBy end: String) {
        let left = webText("Welcome back")
        let stopped = webText("A fresh little moment")
        // A page that has just loaded can take a tap before its script listens: tap the tab until the page answers.
        var runs: Bool?
        for _ in 0..<3 where runs == nil {
            tap(tab)
            runs = says(left, or: stopped, within: retry)
        }
        guard let runs else { return XCTFail("the page does not say whether \(tab) runs") }
        if runs {
            tap(end)
            XCTAssertTrue(webText("finished").waitForExistence(timeout: page))
        }
    }

    /// Ends a Buttons activity that an earlier attempt left, before Rust starts the example: Rust's start would return
    /// that activity, with the card it has. Only after a test of this run has failed, which is when one can be left:
    /// the page ends it, and a run without a failure needs no page for the test where Rust starts.
    private func endLeftoverButtons() {
        guard Self.failed else { return }
        launch()
        openStopped("Buttons")
        app.terminate()
    }

    /// Pulls the Lock Screen over the app, from a fixed point at the top of the screen.
    private func pullLockScreen() {
        let top = app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.01))
        let bottom = app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.8))
        top.press(forDuration: 0.1, thenDragTo: bottom)
    }

    /// Pulls the Lock Screen until `element` shows, at most three times: a pull that lands while the app's window still
    /// moves can leave the Lock Screen without its cards (seen once on a fresh simulator).
    private func pullLockScreen(until element: XCUIElement) -> Bool {
        for attempt in 0..<3 {
            if attempt > 0 {
                XCUIDevice.shared.press(.home)
                app.activate()
                _ = app.wait(for: .runningForeground, timeout: system)
            }
            pullLockScreen()
            if element.waitForExistence(timeout: system) { return true }
        }
        return false
    }

    private func leaveLockScreen() {
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: system))
    }

    /// Pulls the Lock Screen over the Home Screen: the app is not in front, or does not run.
    private func pullLockScreenOverHome() {
        let top = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.01))
        top.press(forDuration: 0.1, thenDragTo: springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.8)))
    }

    /// Pulls the Lock Screen over the Home Screen until `element` shows, at most three times: a shared runner's
    /// simulator sometimes loses the pull and stays on the Home Screen (seen once, right after the app was ended).
    private func pullLockScreenOverHome(until element: XCUIElement) -> Bool {
        for attempt in 0..<3 {
            if attempt > 0 { XCUIDevice.shared.press(.home) }
            pullLockScreenOverHome()
            if element.waitForExistence(timeout: system) { return true }
        }
        return false
    }

    /// What the Lock Screen shows under `label`, whatever kind of element the system makes of it.
    private func onLockScreen(_ label: String) -> XCUIElement {
        springboard.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    /// Whether `condition` holds within `timeout`.
    private func holds(within timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            RunLoop.current.run(until: Date().addingTimeInterval(0.25))
        }
        return condition()
    }

    /// Ends the example that the page shows as running.
    private func endExample() {
        tap("End this example")
        XCTAssertTrue(webText("has ended").waitForExistence(timeout: page))
    }

    // TP-E2E-1, TP-E2E-6, TP-BUILD-1, TP-IOS-1, TP-IOS-3
    func test1BoundStyleShowsOnTheLockScreen() {
        launch()
        openStopped("Changing styles")
        tap("Start this example")
        allow()
        XCTAssertTrue(webText("is on its way to your phone").waitForExistence(timeout: page))
        tap("Send new values")
        XCTAssertTrue(webText("New values sent at revision 1").waitForExistence(timeout: page))
        XCTAssertTrue(pullLockScreen(until: springboard.staticTexts["Running 5 min late"]))
        capture("e2e-1-bound-style-lock-screen")
        // The system asks on the Lock Screen card whether the app may keep showing Live Activities.
        allow()
        leaveLockScreen()
        tap("End this example")
        XCTAssertTrue(webText("has ended").waitForExistence(timeout: page))
    }

    // TP-E2E-2, TP-E2E-6, TP-ACTION-1
    func test2LockScreenButtonReachesRustAndJavaScript() {
        launch()
        openStopped("Buttons")
        tap("Start this example")
        XCTAssertTrue(webText("is on its way to your phone").waitForExistence(timeout: page))
        let pet = springboard.buttons["Pet Mochi"].firstMatch
        XCTAssertTrue(pullLockScreen(until: pet))
        capture("e2e-2-buttons-before")
        pet.tap()
        // Rust's on_action handler (examples/demo/src-tauri/src/actions.rs) counts the pet with an update.
        XCTAssertTrue(springboard.staticTexts["Purring. 1 pet so far"].waitForExistence(timeout: reaction))
        // The Lock Screen draws the new content a moment after it reports it.
        XCTAssertTrue(springboard.staticTexts["No pets yet"].waitForNonExistence(timeout: redraw))
        capture("e2e-2-buttons-after-rust")
        leaveLockScreen()
        // The page's onAction listener shows the tap, in its message and under Developer tools. A button's tap has no
        // `on`: with one the message reads "asked off" or "asked on", and the record ends with the member.
        XCTAssertTrue(webText("Mochi felt “pet” from the Buttons example.").waitForExistence(timeout: page))
        tap("Developer tools")
        let heard = webText("Last tap: {\"actionId\":\"pet\"")
        XCTAssertTrue(heard.waitForExistence(timeout: page))
        let record = #"^Last tap: \{"actionId":"pet","activityId":"[^"]+","activityKey":"mochi:buttons"\}$"#
        XCTAssertNotNil(heard.label.range(of: record, options: .regularExpression), heard.label)
        capture("e2e-2-tap-in-javascript")
        tap("End this example")
        XCTAssertTrue(webText("has ended").waitForExistence(timeout: page))
    }

    // TP-E2E-3, TP-E2E-6, TP-IOS-6
    func test3ListAfterARelaunchFindsTheActivity() {
        launch()
        openStopped("Buttons")
        tap("Start this example")
        XCTAssertTrue(webText("is on its way to your phone").waitForExistence(timeout: page))
        // Rust's handler sends revision 1 for the pet.
        let pet = springboard.buttons["Pet Mochi"].firstMatch
        XCTAssertTrue(pullLockScreen(until: pet))
        pet.tap()
        XCTAssertTrue(springboard.staticTexts["Purring. 1 pet so far"].waitForExistence(timeout: reaction))
        leaveLockScreen()
        app.terminate()
        launch()
        openLayouts("Buttons")
        // listLayout at launch found the running activity: the page offers to end it, at the revision Rust sent.
        XCTAssertTrue(web("End this example").waitForExistence(timeout: page))
        XCTAssertTrue(webText("ON YOUR PHONE NOW").waitForExistence(timeout: page))
        tap("Developer tools")
        XCTAssertTrue(webText("Purring. 1 pet so far").waitForExistence(timeout: page))
        capture("e2e-3-listed-after-relaunch")
        tap("End this example")
        XCTAssertTrue(webText("has ended").waitForExistence(timeout: page))
    }

    // TP-E2E-4, TP-IOS-2, TP-IOS-3, TP-IOS-5, TP-V1-2, TP-PUSH-1, TP-PUSH-2, TP-PUSH-8
    func test4LifecycleChecksPassThroughTauri() {
        launch()
        tap("Developer tools")
        tap("Run lifecycle test")
        XCTAssertTrue(webText("Integration test: passed.").waitForExistence(timeout: selfTest), app.debugDescription)
        capture("e2e-4-lifecycle-passed")
    }

    // TP-V1-1
    func test5TemplatesShowOnTheLockScreenAsLayouts() {
        launch()
        openStoppedTemplate("Snack delivery", endedBy: "Finish delivery")
        tap("Start snack delivery")
        XCTAssertTrue(pullLockScreen(until: springboard.staticTexts["Mochi’s snack delivery"]))
        allow()
        XCTAssertTrue(springboard.staticTexts["Mochi’s snack delivery"].waitForExistence(timeout: system))
        capture("e2e-5-v1-progress")
        leaveLockScreen()
        tap("Finish delivery")
        openStoppedTemplate("Nap timer", endedBy: "Wake up, sleepyhead")
        tap("Start a little nap")
        XCTAssertTrue(pullLockScreen(until: springboard.staticTexts["Mochi’s nap"]))
        capture("e2e-5-v1-timer")
        leaveLockScreen()
        tap("Wake up, sleepyhead")
        XCTAssertTrue(webText("Nap finished").waitForExistence(timeout: page))
    }

    // TP-E2E-5, TP-ACTION-3
    func test6TapLaunchesTheAppForASlowRustHandler() {
        launch()
        openStopped("Buttons")
        tap("Start this example")
        XCTAssertTrue(webText("is on its way to your phone").waitForExistence(timeout: page))
        app.terminate()
        XCTAssertTrue(app.wait(for: .notRunning, timeout: system))
        // The Lock Screen over the Home Screen: the system launches the app in the background for the tap.
        let pet = springboard.buttons["Pet Mochi"].firstMatch
        XCTAssertTrue(pullLockScreenOverHome(until: pet))
        XCTAssertTrue(springboard.staticTexts["No pets yet"].waitForExistence(timeout: redraw))
        pet.tap()
        // The handler takes a second (COUNTING in examples/demo/src-tauri/src/actions.rs), then updates the activity.
        XCTAssertTrue(springboard.staticTexts["Purring. 1 pet so far"].waitForExistence(timeout: reaction))
        XCTAssertTrue(springboard.staticTexts["No pets yet"].waitForNonExistence(timeout: redraw))
        capture("e2e-6-background-tap-after-slow-handler")
        XCTAssertNotEqual(app.state, .runningForeground)
        XCUIDevice.shared.press(.home)
        launch()
        openLayouts("Buttons")
        tap("End this example")
        XCTAssertTrue(webText("has ended").waitForExistence(timeout: page))
    }

    // TP-E2E-6
    /// Rust starts the Buttons example (`--start-buttons`), so the test needs no page: in the build of `tauri ios dev`
    /// the page comes from Tauri's server. The widget draws the layout and a tap reaches the Rust handler.
    func test7RustStartsALayoutWhoseButtonReachesRust() {
        endLeftoverButtons()
        let top = springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.01))
        let pull = { top.press(forDuration: 0.1, thenDragTo: self.springboard.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.8))) }
        app.launchArguments = ["--start-buttons"]
        app.launch()
        XCUIDevice.shared.press(.home)
        pull()
        let pet = springboard.buttons["Pet Mochi"].firstMatch
        XCTAssertTrue(pet.waitForExistence(timeout: system))
        XCTAssertTrue(springboard.staticTexts["No pets yet"].waitForExistence(timeout: redraw))
        allow()
        pet.tap()
        XCTAssertTrue(springboard.staticTexts["Purring. 1 pet so far"].waitForExistence(timeout: reaction))
        XCTAssertTrue(springboard.staticTexts["No pets yet"].waitForNonExistence(timeout: redraw))
        capture("e2e-7-rust-start-and-button")
        springboard.buttons["All done"].firstMatch.tap()
        XCTAssertTrue(springboard.buttons["Pet Mochi"].waitForNonExistence(timeout: system))
    }

    // TP-E2E-7, TP-ACTION-1
    /// A switch on the Lock Screen shows its flag. A tap reaches Rust with the state the person asked for, Rust's
    /// update moves the switch, and the page hears the tap with that state.
    func test8ASwitchReportsTheStateThePersonAskedFor() {
        launch()
        openStopped("Switch")
        tap("Start this example")
        XCTAssertTrue(webText("is on its way to your phone").waitForExistence(timeout: page))
        let purr = onLockScreen("Purr alerts")
        XCTAssertTrue(pullLockScreen(until: purr), springboard.debugDescription)
        allow()
        XCTAssertEqual(purr.elementType, .switch)
        XCTAssertEqual(purr.value as? String, "0")
        XCTAssertTrue(springboard.staticTexts["Quiet as a mouse"].waitForExistence(timeout: redraw))
        capture("e2e-8-switch-off")
        purr.tap()
        // Rust's handler (examples/demo/src-tauri/src/actions.rs) sets the flag it was asked for, with an update.
        XCTAssertTrue(springboard.staticTexts["Purring out loud"].waitForExistence(timeout: reaction))
        XCTAssertTrue(holds(within: redraw) { purr.value as? String == "1" }, "the update moves the switch")
        capture("e2e-8-switch-on")
        leaveLockScreen()
        tap("Developer tools")
        XCTAssertTrue(webText("\"actionId\":\"purr\"").waitForExistence(timeout: page))
        XCTAssertTrue(webText("\"on\":true").waitForExistence(timeout: page))
        // The switch that is on asks for off.
        XCTAssertTrue(pullLockScreen(until: purr))
        purr.tap()
        XCTAssertTrue(springboard.staticTexts["Quiet as a mouse"].waitForExistence(timeout: reaction))
        XCTAssertTrue(holds(within: redraw) { purr.value as? String == "0" })
        leaveLockScreen()
        XCTAssertTrue(webText("\"on\":false").waitForExistence(timeout: page))
        capture("e2e-8-switch-in-javascript")
        endExample()
    }

    // TP-E2E-8
    /// A link on the Lock Screen opens the app, which was not in front.
    func test9ALinkOnTheLockScreenOpensTheApp() {
        launch()
        openStopped("Link")
        tap("Start this example")
        XCTAssertTrue(webText("is on its way to your phone").waitForExistence(timeout: page))
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(holds(within: system) { app.state != .runningForeground }, "the app leaves the foreground")
        pullLockScreenOverHome()
        let jar = onLockScreen("Open the treat jar")
        XCTAssertTrue(jar.waitForExistence(timeout: system), springboard.debugDescription)
        allow()
        capture("e2e-9-link")
        jar.tap()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: system), "the link opens the app")
        XCTAssertTrue(web("Layouts").waitForExistence(timeout: pageLoad))
        openLayouts("Link")
        endExample()
    }

    // TP-E2E-9, TP-E2E-12
    /// Content whose stale time has passed turns the Lock Screen: the line for fresh content goes and the line for
    /// stale content comes, with no update and with the app ended. The page then lists the activity as stale, and an
    /// update makes it fresh again. The example starts twice in one launch of the app. The first start is for its
    /// card alone: a simulator's first card has come after the stale time (seen on a shared runner, where the system
    /// asked the widget extension for it half a minute after the start and twice ended an extension that was slow
    /// to answer). The second start is the one that is judged. No launch of the app comes between the two: it would
    /// end the app that runs, and the extension's process with it.
    func test10ContentPastItsStaleTimeTurnsTheLockScreen() {
        launch()
        openStopped("Staleness")
        tap("Start this example")
        XCTAssertTrue(webText("is on its way to your phone").waitForExistence(timeout: page))
        // This start keeps no time: the card shows its title whether its content is fresh or stale.
        let title = springboard.staticTexts.matching(NSPredicate(format: "label == %@", "Mochi’s snack tracker"))
        XCTAssertTrue(pullLockScreen(until: title.firstMatch))
        allow()
        leaveLockScreen()
        endExample()
        openStopped("Staleness")
        tap("Start this example")
        XCTAssertTrue(webText("is on its way to your phone").waitForExistence(timeout: page))
        let fresh = springboard.staticTexts["Left the kitchen"]
        let stale = springboard.staticTexts["Waiting for news of the snack"]
        XCTAssertTrue(pullLockScreen(until: fresh))
        XCTAssertEqual(title.count, 1, "the card of the first start is gone")
        XCTAssertFalse(stale.exists, "fresh content draws no node for stale content")
        capture("e2e-10-fresh")
        // The system asks again under this card whether the app may keep showing Live Activities.
        allow()
        // The change is the system's and the widget's: the app does not run while the time passes.
        app.terminate()
        XCTAssertTrue(stale.waitForExistence(timeout: staleness), "past the stale time, the node for stale content shows")
        XCTAssertTrue(fresh.waitForNonExistence(timeout: redraw), "and the node for fresh content is gone")
        capture("e2e-10-stale")
        XCUIDevice.shared.press(.home)
        launch()
        openLayouts("Staleness")
        XCTAssertTrue(webText("NEEDS A LITTLE UPDATE").waitForExistence(timeout: page))
        tap("Send new values")
        XCTAssertTrue(webText("New values sent at revision 1").waitForExistence(timeout: page))
        XCTAssertTrue(pullLockScreen(until: springboard.staticTexts["Around the corner"]))
        XCTAssertTrue(stale.waitForNonExistence(timeout: redraw), "an update makes the content fresh again")
        capture("e2e-10-fresh-again")
        leaveLockScreen()
        endExample()
    }

    // TP-E2E-10
    /// A scheduled start is pending until its time. The system begins it then, with the app ended, and the app that
    /// is launched afterwards lists it as running.
    func test11AScheduledStartBeginsAtItsTimeWithTheAppEnded() {
        launch()
        openStopped("Scheduled start")
        let asked = Date()
        tap("Start this example")
        XCTAssertTrue(webText("is waiting for its time").waitForExistence(timeout: page))
        XCTAssertTrue(webText("WAITING FOR ITS TIME").waitForExistence(timeout: page))
        capture("e2e-11-pending")
        app.terminate()
        XCTAssertTrue(app.wait(for: .notRunning, timeout: system))
        // The page set the time after `asked`: an app that ended sooner than that did not begin the activity.
        XCTAssertLessThan(Date().timeIntervalSince(asked), startsIn, "the app ended before the activity's time")
        pullLockScreenOverHome()
        let dinner = springboard.staticTexts["Dinner is served"]
        XCTAssertTrue(dinner.waitForExistence(timeout: startsIn + beginning), springboard.debugDescription)
        allow()
        capture("e2e-11-begun")
        XCUIDevice.shared.press(.home)
        launch()
        openLayouts("Scheduled start")
        XCTAssertTrue(webText("ON YOUR PHONE NOW").waitForExistence(timeout: page))
        endExample()
    }

    // TP-E2E-11
    /// A test that runs again finds its example stopped. An attempt that failed has ended nothing; the next attempt
    /// launches the app anew, whose page lists the activity, and ends it there before it starts, with no look at the
    /// Lock Screen.
    func test12ARetryFindsItsExampleStopped() {
        launch()
        openStopped("Buttons")
        tap("Start this example")
        XCTAssertTrue(webText("is on its way to your phone").waitForExistence(timeout: page))
        // Here the attempt fails, as far as the next one can tell: the example runs, and the app is launched anew.
        app.terminate()
        XCTAssertTrue(app.wait(for: .notRunning, timeout: system))
        launch()
        openStopped("Buttons")
        XCTAssertTrue(webText("Buttons has ended").waitForExistence(timeout: page), "what the attempt left is ended")
        XCTAssertTrue(web("Start this example").waitForExistence(timeout: page), "and the example can start anew")
        XCTAssertFalse(web("End this example").exists)
    }
}
