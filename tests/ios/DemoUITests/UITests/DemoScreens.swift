import UIKit
import XCTest

/// The pictures of the demo that the documents show (docs/images): its page, the Lock Screen's card of each layout
/// example and of the two templates, and the Dynamic Island. It tests nothing of the plugin and proves no
/// requirement, so every method is skipped unless the run asks for the pictures:
///
///     TEST_RUNNER_DEMO_SCREENS=1 ONLY=DemoScreens tests/ios/run.sh
///
/// The run leaves them in its output folder under the names they have in docs/images. A picture is the simulator's
/// screen as it was, whole or cut to a part of it: nothing is drawn over it or changed afterwards. The methods run in
/// the order of their names, and each ends what it started.
final class DemoScreens: XCTestCase {
    private let app = XCUIApplication(bundleIdentifier: "io.github.eedaegon.liveactivitydemo")
    private let springboard = XCUIApplication(bundleIdentifier: "com.apple.springboard")
    /// The waits of DemoTests, for the same things: the first page of a fresh simulator, a tap's answer on the page,
    /// a change that the system shows, an update that a tap on the Lock Screen brings, a tap that the page did not
    /// take, the system's question, a card's new content once it is reported, the lifecycle test.
    private let pageLoad: TimeInterval = 90
    private let page: TimeInterval = 30
    private let system: TimeInterval = 30
    private let reaction: TimeInterval = 90
    private let retry: TimeInterval = 10
    private let prompt: TimeInterval = 2
    private let redraw: TimeInterval = 15
    private let selfTest: TimeInterval = 120
    /// How long the Lock Screen may take to turn to stale content, and to begin a scheduled start and draw it
    /// (`freshFor` and `startsIn` in examples/demo/src/layouts.ts are 45 s and 30 s; the system adds its own time).
    private let staleness: TimeInterval = 180
    private let beginning: TimeInterval = 150
    /// How long a card or the page gets to finish drawing before its picture is taken.
    private let settling: TimeInterval = 1.5
    /// What a picture of a card or of the island shows around it, in points.
    private let margin: CGFloat = 12
    /// The heights of the status bar and of the home indicator on the simulator's iPhone. The page's content passes
    /// under both, so a picture of the page that was scrolled leaves them out.
    private let statusBar: CGFloat = 62
    private let homeIndicator: CGFloat = 34
    /// A column of the screen within every card's own margin, where a card has nothing but its background: the Lock
    /// Screen's cards begin 14 points from the screen's edge, and their content 16 points further in. And how much
    /// of a card's height its round corners hide in that column.
    private let cardMargin: CGFloat = 22
    private let cardCorner: CGFloat = 8
    /// How high a card is in that column, with the system's question under it or without: the lowest of the demo's
    /// is 59 points and the highest 182. A search for a card's lines that ends outside has found no card.
    private let cardHeights: ClosedRange<CGFloat> = 40...300
    /// The screen of the simulator that tests/ios/run.sh creates when it is told no other, an iPhone 17 Pro: the
    /// measures above are its own.
    private let screenSize = CGSize(width: 402, height: 874)

    /// How often this run has answered the system's question about Live Activities: it asks under an app's first
    /// card ("Allow") and under its second ("Always Allow"), and not after.
    private static var answered = 0
    /// The pictures of this run whose card the simulator drew light all the same (`drawnLight`).
    private static var light = Set<String>()
    /// Whether the run asks for the pictures.
    private var asked: Bool { ProcessInfo.processInfo.environment["DEMO_SCREENS"] == "1" }
    /// The pixels of a picture, four bytes each, line after line from the top.
    private struct Bitmap {
        let bytes: [UInt8]
        let width: Int
        let height: Int

        init?(_ image: UIImage) {
            guard let source = image.cgImage else { return nil }
            width = source.width
            height = source.height
            var drawn = [UInt8](repeating: 0, count: source.width * source.height * 4)
            let filled = drawn.withUnsafeMutableBytes { buffer -> Bool in
                guard let context = CGContext(data: buffer.baseAddress, width: source.width, height: source.height,
                    bitsPerComponent: 8, bytesPerRow: source.width * 4, space: CGColorSpaceCreateDeviceRGB(),
                    bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
                context.draw(source, in: CGRect(x: 0, y: 0, width: source.width, height: source.height))
                return true
            }
            guard filled else { return nil }
            bytes = drawn
        }

        /// Whether the color changes at once between two lines of one column: an edge, where a background only shades.
        func jumps(x: Int, from first: Int, to second: Int) -> Bool {
            let (one, other) = ((first * width + x) * 4, (second * width + x) * 4)
            return (0..<3).reduce(0) { $0 + abs(Int(bytes[one + $1]) - Int(bytes[other + $1])) } > 24
        }

        /// Whether a pixel is nearer to white than to black.
        func isLight(x: Int, y: Int) -> Bool {
            let at = (y * width + x) * 4
            return Int(bytes[at]) + Int(bytes[at + 1]) + Int(bytes[at + 2]) > 3 * 128
        }
    }

    override func setUpWithError() throws {
        continueAfterFailure = false
        try XCTSkipUnless(asked, "the pictures are taken only in a run that asks for them")
    }

    /// Leaves two things beside the pictures: after a failure the screen as it is, and the names of the pictures of
    /// this run so far that show a light card, so that nobody has to look at each. The list is written also when it
    /// has no name: an older one in the output folder would be read as this run's.
    override func tearDown() {
        guard asked else { return }
        // The count of failures so far: `hasSucceeded` is false of every test here, where its run has not ended.
        if let run = testRun, run.totalFailureCount > 0 {
            let test = name.split(separator: " ").last.map { String($0.dropLast()) } ?? name
            keep("e2e-failed-\(test)", XCUIScreen.main.screenshot().image)
        }
        let note = XCTAttachment(string: Self.light.sorted().joined(separator: "\n") + "\n")
        note.name = "light-cards"
        note.lifetime = .keepAlways
        add(note)
    }

    // MARK: The page

    /// A button of the page; one with `aria-pressed`, like the mode and example chips, is a switch to WebKit.
    private func web(_ label: String) -> XCUIElement {
        let kinds = [XCUIElement.ElementType.button.rawValue, XCUIElement.ElementType.switch.rawValue]
        let match = NSPredicate(format: "elementType IN %@ AND label BEGINSWITH %@", kinds, label)
        return app.webViews.descendants(matching: .any).matching(match).firstMatch
    }

    private func webText(_ part: String) -> XCUIElement {
        app.webViews.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", part)).firstMatch
    }

    private func pause(_ seconds: TimeInterval) {
        RunLoop.current.run(until: Date().addingTimeInterval(seconds))
    }

    /// Whether `condition` holds within `timeout`.
    private func holds(within timeout: TimeInterval, _ condition: () -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if condition() { return true }
            pause(0.25)
        }
        return condition()
    }

    /// Moves the page by `distance` points, from a point in its left margin: a drag that begins on a block with a
    /// scroll bar of its own, as the lists of Developer tools have, would move that block.
    private func drag(from y: CGFloat, by distance: CGFloat) {
        let from = app.coordinate(withNormalizedOffset: .zero).withOffset(CGVector(dx: 8, dy: y))
        from.press(forDuration: 0.05, thenDragTo: from.withOffset(CGVector(dx: 0, dy: distance)), withVelocity: .slow,
            thenHoldForDuration: 0.3)
    }

    /// Scrolls the page until `element` is on the screen, whichever way it lies.
    private func reveal(_ element: XCUIElement) {
        let top = statusBar + 20
        let bottom = app.frame.height - homeIndicator - 20
        for _ in 0..<12 {
            let middle = element.frame.midY
            if middle >= top && middle <= bottom { return }
            drag(from: app.frame.midY, by: middle < top ? 300 : -300)
        }
        XCTAssertTrue(app.frame.contains(CGPoint(x: element.frame.midX, y: element.frame.midY)), "the page does not bring \(element) onto the screen")
    }

    /// Brings `element` onto the screen and drags the page once more, so that the middle of `element` comes `y`
    /// points below the top of the screen, as nearly as a drag does it and as far as the page goes.
    private func scroll(_ element: XCUIElement, to y: CGFloat) {
        XCTAssertTrue(element.waitForExistence(timeout: page))
        reveal(element)
        drag(from: element.frame.midY, by: y - element.frame.midY)
        pause(0.5)
    }

    /// Scrolls the page to its top: a drag that asks for more than the page has ends there.
    private func scrollToTop() {
        scroll(web("Snack delivery"), to: app.frame.height * 0.6)
    }

    private func tap(_ label: String) {
        let button = web(label)
        XCTAssertTrue(button.waitForExistence(timeout: page), "no button \(label)")
        // The page disables its buttons while it works on the tap before.
        XCTAssertTrue(holds(within: page) { button.isEnabled }, "the button \(label) stays disabled")
        reveal(button)
        button.tap()
    }

    /// Taps a button of the page until `done` holds: a simulator sometimes loses a tap. A tap that was taken is not
    /// given again, since the page disables or hides its button then.
    private func tap(_ label: String, until done: () -> Bool) {
        for _ in 0..<3 {
            tap(label)
            if holds(within: retry, done) { return }
            let button = web(label)
            if !button.exists || !button.isEnabled { break }
        }
        XCTAssertTrue(holds(within: page, done), "the tap on \(label) did nothing")
    }

    private func launch() {
        app.launch()
        XCTAssertTrue(web("Layouts").waitForExistence(timeout: pageLoad), "no page")
        XCTAssertEqual(app.frame.size, screenSize, "the pictures are cut by the measures of an iPhone 17 Pro")
    }

    /// Opens `example` on the Layouts tab. True when the page says that the example runs.
    @discardableResult
    private func open(_ example: String) -> Bool {
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: system))
        let chip = web(example)
        // A page that has just loaded can take a tap before its script listens: tap the tab until it opens.
        for _ in 0..<3 where !chip.exists {
            tap("Layouts")
            _ = chip.waitForExistence(timeout: retry)
        }
        let stopped = webText("\(example): start it to see it on your phone")
        let runs = webText("\(example) is already on your phone")
        // The page answers the tap on a chip with one of the two lines.
        tap(example, until: { stopped.exists || runs.exists })
        return runs.exists
    }

    /// Starts `example` from the page, after ending what an earlier attempt left of it, and sends `updates`.
    private func start(_ example: String, updates: Int = 0, answer: String = "is on its way to your phone") {
        if open(example) { end(example) }
        let started = webText("\(example) \(answer)")
        tap("Start this example", until: { started.exists })
        for revision in 0..<updates { update(to: revision + 1) }
    }

    private func update(to revision: Int) {
        let sent = webText("New values sent at revision \(revision)")
        tap("Send new values", until: { sent.exists })
    }

    private func end(_ example: String) {
        let ended = webText("\(example) has ended")
        tap("End this example", until: { ended.exists })
    }

    /// Takes the pointer off the button that was tapped last, which the page draws darker under it: a tap on the
    /// request's heading and one more, which leave it as it was.
    private func restRequestHeading() {
        tap("The request")
        tap("The request")
    }

    // MARK: The Lock Screen

    /// Pulls the Lock Screen over the app, from a fixed point at the top of the screen.
    private func pullLockScreen() {
        let top = app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.01))
        top.press(forDuration: 0.1, thenDragTo: app.coordinate(withNormalizedOffset: CGVector(dx: 0.1, dy: 0.8)))
    }

    /// Pulls the Lock Screen until it shows `label`, at most three times: a pull that lands while the app's window
    /// still moves can leave the Lock Screen without its cards.
    private func pullLockScreen(until label: String) {
        for attempt in 0..<3 {
            if attempt > 0 { leaveLockScreen() }
            pullLockScreen()
            if onLockScreen(label).waitForExistence(timeout: system) { return }
        }
        XCTFail("the Lock Screen shows no \(label)")
    }

    private func leaveLockScreen() {
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: system))
    }

    /// What the Lock Screen shows under `label`, whatever kind of element the system makes of it.
    private func onLockScreen(_ label: String) -> XCUIElement {
        springboard.descendants(matching: .any).matching(NSPredicate(format: "label == %@", label)).firstMatch
    }

    /// Answers the system's question under a card, and waits until the question has left the card.
    private func allow() {
        guard Self.answered < 2 else { return }
        for label in ["Always Allow", "Allow"] {
            let control = springboard.buttons[label].firstMatch
            guard control.waitForExistence(timeout: prompt) else { continue }
            control.tap()
            XCTAssertTrue(control.waitForNonExistence(timeout: system), "the system's question stays under the card")
            Self.answered += 1
        }
    }

    // MARK: The pictures

    /// Keeps `screen` under `name`: the part within `frame`, in points, or all of it.
    private func keep(_ name: String, _ screen: UIImage, _ frame: CGRect? = nil) {
        var picture = screen
        if let frame {
            let whole = screen.cgImage
            let pixels = frame.applying(CGAffineTransform(scaleX: screen.scale, y: screen.scale)).integral
                .intersection(CGRect(x: 0, y: 0, width: whole?.width ?? 0, height: whole?.height ?? 0))
            guard let part = whole?.cropping(to: pixels) else { return XCTFail("\(name): nothing of \(frame) is on the screen") }
            picture = UIImage(cgImage: part, scale: screen.scale, orientation: .up)
        }
        let kept = XCTAttachment(image: picture, quality: .original)
        kept.name = name
        kept.lifetime = .keepAlways
        add(kept)
    }

    /// The whole screen, with the page at its top.
    private func keepScreen(_ name: String) {
        pause(settling)
        keep(name, XCUIScreen.main.screenshot().image)
    }

    /// The page as the screen shows it, without the status bar and the home indicator.
    private func keepPage(_ name: String) {
        pause(settling)
        let screen = XCUIScreen.main.screenshot().image
        keep(name, screen, CGRect(x: 0, y: statusBar, width: screen.size.width, height: screen.size.height - statusBar - homeIndicator))
    }

    /// The line of the screen's picture through the middle of `part`, or nothing for a part that the Lock Screen
    /// gives no place on the screen.
    private func line(of part: XCUIElement, on screen: UIImage) -> Int? {
        let frame = part.frame
        guard !frame.isEmpty, frame.midY.isFinite, frame.midY >= 0, frame.midY < screen.size.height else { return nil }
        return Int(frame.midY * screen.scale)
    }

    /// The Lock Screen's card that holds `parts`, with the wallpaper around it. The system gives a card no frame that
    /// says where it is on the screen, so the picture is asked: from the line of each part, up and down a column
    /// within the card's margin, as far as the color goes on without a jump. The picture also says whether the card
    /// came light, in that column on the line of the first part.
    private func keepCard(_ name: String, around parts: [XCUIElement]) {
        pause(settling)
        let screen = XCUIScreen.main.screenshot().image
        guard let shown = Bitmap(screen) else { return XCTFail("no picture of the screen") }
        let column = Int(cardMargin * screen.scale)
        var lines: ClosedRange<Int>?
        var light: Bool?
        for part in parts {
            guard let line = line(of: part, on: screen) else { return XCTFail("\(name): the Lock Screen gives \(part) no place") }
            var (first, last) = (line, line)
            while first > 0 && !shown.jumps(x: column, from: first, to: first - 1) { first -= 1 }
            while last < shown.height - 1 && !shown.jumps(x: column, from: last, to: last + 1) { last += 1 }
            lines = min(first, lines?.lowerBound ?? first)...max(last, lines?.upperBound ?? last)
            light = light ?? shown.isLight(x: column, y: line)
        }
        guard let lines, let light else { return XCTFail("no part of a card to look for") }
        let height = CGFloat(lines.count) / screen.scale
        guard cardHeights.contains(height) else { return XCTFail("\(name): no card around its parts, \(Int(height)) points without an edge") }
        let around = cardCorner + margin
        let top = CGFloat(lines.lowerBound) / screen.scale - around
        keep(name, screen, CGRect(x: 0, y: top, width: screen.size.width, height: CGFloat(lines.upperBound) / screen.scale + around - top))
        // A picture that was taken again counts as it is now.
        if light { Self.light.insert(name) } else { Self.light.remove(name) }
    }

    /// The card once it shows `label` and no longer `old`, with the system's question answered.
    private func keepCard(_ name: String, showing label: String, not old: String? = nil, within timeout: TimeInterval? = nil) {
        let shown = onLockScreen(label)
        XCTAssertTrue(shown.waitForExistence(timeout: timeout ?? reaction), "the Lock Screen shows no \(label)")
        // The Lock Screen draws new content a moment after it reports it.
        if let old { XCTAssertTrue(onLockScreen(old).waitForNonExistence(timeout: redraw), "the Lock Screen still shows \(old)") }
        allow()
        keepCard(name, around: [shown])
    }

    /// Whether the simulator drew the card that shows `label` on a light background. It draws the demo's cards in
    /// its dark scheme, text and all, but a card often came on the light background under that white text: one
    /// with a timer every time while its activity had no update, others now and then. A wait, a second look and
    /// the other appearance changed nothing of a card that had come so.
    private func drawnLight(_ label: String) -> Bool {
        let screen = XCUIScreen.main.screenshot().image
        guard let shown = Bitmap(screen), let line = line(of: onLockScreen(label), on: screen) else { return false }
        return shown.isLight(x: Int(cardMargin * screen.scale), y: line)
    }

    /// Brings a card onto the Lock Screen that shows `label`, on a dark background if the simulator gives one in
    /// four attempts: `begin` starts its activity on the page, and the Lock Screen is pulled. A card that came out
    /// light is left, with the system's question unanswered, `finish` ends its activity on the page, and it is begun
    /// again. The fourth card stays as it came.
    private func bringDark(_ label: String, begin: () -> Void, finish: () -> Void) {
        for attempt in 0..<4 {
            begin()
            pullLockScreen(until: label)
            pause(settling)
            if attempt == 3 || !drawnLight(label) { return }
            leaveLockScreen()
            finish()
        }
    }

    /// Starts `example` with its `updates` and brings its card, which shows `label`, onto the Lock Screen
    /// (`bringDark`).
    private func show(_ example: String, updates: Int = 0, showing label: String) {
        bringDark(label, begin: { start(example, updates: updates) }, finish: { end(example) })
    }

    /// Ends the activity of a template that an earlier attempt of the method left: the page then has the button
    /// that ends it where the one that starts it would be.
    private func endLeftover(_ end: String, saying ended: String, where start: String) {
        guard !web(start).waitForExistence(timeout: retry) else { return }
        tap(end, until: { webText(ended).exists })
    }

    /// Starts `example`, keeps its card under `name` once the Lock Screen shows `label`, and ends it.
    private func picture(of example: String, updates: Int = 0, showing label: String, as name: String) {
        show(example, updates: updates, showing: label)
        keepCard(name, showing: label)
        leaveLockScreen()
        end(example)
    }

    /// The Dynamic Island's parts on the screen: the system names them after its own name for the island.
    private var island: XCUIElementQuery {
        springboard.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH %@", "jindo-container-view"))
    }

    /// The island as the screen shows it after `wait`: every part of it, with a margin.
    private func keepIsland(_ name: String, after wait: TimeInterval) {
        pause(wait)
        let screen = XCUIScreen.main.screenshot().image
        let parts = island.allElementsBoundByIndex.map(\.frame).filter { !$0.isEmpty }
        guard let first = parts.first else { return XCTFail("the screen shows no Dynamic Island") }
        keep(name, screen, parts.dropFirst().reduce(first) { $0.union($1) }.insetBy(dx: -margin, dy: -margin))
    }

    // MARK: The walks

    /// The two templates: the page with each under way, each template's card, and the system's question under the
    /// app's first card. Each card is taken after an update.
    func test1TheTemplates() {
        launch()
        tap("Snack delivery")
        endLeftover("Finish delivery", saying: "Delivery finished", where: "Start snack delivery")
        var pictured = false
        bringDark("On the way to Mochi", begin: {
            tap("Start snack delivery", until: { web("Send it on its way").exists })
            tap("Send it on its way", until: { webText("65%").exists })
            guard !pictured else { return }
            scrollToTop()
            // The tab that is open takes the pointer off the button that was tapped last.
            tap("Snack delivery")
            keepScreen("ios-demo-snack")
            pictured = true
        }, finish: {
            tap("Finish delivery", until: { webText("Delivery finished").exists })
        })
        // The system asks under the first card of an app that it has not been answered about.
        if Self.answered == 0 {
            let question = springboard.buttons["Allow"].firstMatch
            XCTAssertTrue(question.waitForExistence(timeout: retry), "the system asks nothing under the app's first card")
            keepCard("ios-question", around: [onLockScreen("On the way to Mochi"), question])
        }
        keepCard("ios-v1-progress", showing: "On the way to Mochi")
        leaveLockScreen()
        tap("Finish delivery", until: { webText("Delivery finished").exists })
        tap("Nap timer")
        endLeftover("Wake up, sleepyhead", saying: "Nap finished", where: "Start a little nap")
        pictured = false
        bringDark("Just one more minute…", begin: {
            tap("Start a little nap", until: { web("Wake up, sleepyhead").exists })
            if !pictured {
                scrollToTop()
                tap("Nap timer")
                keepScreen("ios-demo-nap")
                pictured = true
            }
            tap("Snooze for one more minute", until: { webText("Just one more minute…").exists })
        }, finish: {
            tap("Wake up, sleepyhead", until: { webText("Nap finished").exists })
        })
        keepCard("ios-v1-timer", showing: "Just one more minute…")
        leaveLockScreen()
        tap("Wake up, sleepyhead", until: { webText("Nap finished").exists })
    }

    /// The Layouts tab, and the card of each example that only shows something. An example whose values come round
    /// again is taken after a round of updates, with the values of its start.
    func test2TheLayouts() {
        launch()
        open("Text")
        scroll(webText("LAYOUTS"), to: statusBar + 24)
        keepPage("ios-demo-picker")
        picture(of: "Text", updates: 3, showing: "Packing a tiny treat", as: "ios-layout-text")
        picture(of: "Text", updates: 2, showing: "Snack time! Made it home", as: "ios-layout-text-arrived")
        picture(of: "SF Symbols", updates: 3, showing: "A soft purr", as: "ios-layout-symbols")
        picture(of: "Image", showing: "Mochi’s portrait", as: "ios-layout-image")
        picture(of: "Paths", showing: "Mochi, drawn from paths", as: "ios-layout-paths")
        picture(of: "Gauge", updates: 3, showing: "80 g of kibble left", as: "ios-layout-gauge")
        picture(of: "Progress", updates: 1, showing: "On the way to Mochi", as: "ios-layout-progress")
        picture(of: "Timer", updates: 1, showing: "Just one more minute…", as: "ios-layout-timer")
        picture(of: "Stacks", updates: 3, showing: "Snack route", as: "ios-layout-stacks")
        picture(of: "Link", showing: "Open the treat jar", as: "ios-layout-link")
        picture(of: "Watch and car", updates: 1, showing: "On the way to Mochi", as: "ios-layout-small")
        picture(of: "Android", updates: 1, showing: "Fast asleep", as: "ios-layout-android")
        picture(of: "Now Bar", updates: 1, showing: "On the way to Mochi", as: "ios-layout-nowbar")
    }

    /// An update changes a style: the card before and after, and the Layouts tab with the example under way.
    func test3AnUpdateChangesAStyle() {
        launch()
        // Three updates bring the values of the start again.
        show("Changing styles", updates: 3, showing: "On time")
        keepCard("ios-layout-styles-before", showing: "On time")
        leaveLockScreen()
        update(to: 4)
        tap("The request")
        scroll(web("The request"), to: statusBar + 30)
        keepPage("ios-demo-request")
        tap("The request")
        scroll(webText("LAYOUTS"), to: statusBar + 24)
        keepPage("ios-demo-layouts")
        pullLockScreen(until: "Running 5 min late")
        keepCard("ios-layout-styles-after", showing: "Running 5 min late")
        leaveLockScreen()
        end("Changing styles")
    }

    /// A tap on the Lock Screen reaches Rust, whose update changes the card, and the page hears of it.
    func test4TapsReachRust() {
        launch()
        show("Buttons", showing: "No pets yet")
        keepCard("ios-layout-buttons-before", showing: "No pets yet")
        springboard.buttons["Pet Mochi"].firstMatch.tap()
        // Rust's handler counts the pet with an update, a second after the tap (examples/demo/src-tauri/src/actions.rs).
        keepCard("ios-layout-buttons-after", showing: "Purring. 1 pet so far", not: "No pets yet")
        leaveLockScreen()
        XCTAssertTrue(webText("Mochi felt “pet”").waitForExistence(timeout: page))
        tap("Developer tools")
        XCTAssertTrue(webText("Last tap: {\"actionId\":\"pet\"").waitForExistence(timeout: page))
        scroll(webText("Plugin-owned activities"), to: statusBar + 24)
        keepPage("ios-demo-tap")
        tap("Developer tools")
        end("Buttons")

        show("Switch", showing: "Quiet as a mouse")
        // Rust's handler sets the flag that a tap asked for, with an update, and only that moves the switch. Both
        // states are taken after such an update: on after one tap, off after a second.
        onLockScreen("Purr alerts").tap()
        keepCard("ios-layout-switch-on", showing: "Purring out loud", not: "Quiet as a mouse")
        onLockScreen("Purr alerts").tap()
        keepCard("ios-layout-switch-off", showing: "Quiet as a mouse", not: "Purring out loud")
        leaveLockScreen()
        end("Switch")
    }

    /// The time changes a card with no update: content that turns stale, and a start that waits for its time.
    func test5TimeChangesACard() {
        launch()
        // A simulator's first card has come late, after its content had turned stale (DemoTests says so of its own
        // test of this). Run alone, the method draws a card before the one whose time counts.
        if Self.answered == 0 {
            show("Text", showing: "Packing a tiny treat")
            allow()
            leaveLockScreen()
            end("Text")
        }
        show("Staleness", showing: "Left the kitchen")
        keepCard("ios-layout-staleness-fresh", showing: "Left the kitchen")
        keepCard("ios-layout-staleness-stale", showing: "Waiting for news of the snack", not: "Left the kitchen", within: staleness)
        leaveLockScreen()
        end("Staleness")

        start("Scheduled start", answer: "is waiting for its time")
        XCTAssertTrue(webText("WAITING FOR ITS TIME").waitForExistence(timeout: page))
        restRequestHeading()
        scroll(webText("LAYOUTS"), to: statusBar + 24)
        keepPage("ios-demo-pending")
        // The start waits 30 seconds, and the steps up to the picture take most of them on a slow Mac.
        XCTAssertTrue(webText("WAITING FOR ITS TIME").exists, "the scheduled start began before the picture of its page")
        // The Lock Screen has nothing of the activity until its time. The system begins it then, and the demo has no
        // update for it: its card is taken as it comes, which on the simulator was light more often than dark.
        // A pull can be lost, so the wait for the card is three pulls long.
        var began = false
        for _ in 0..<3 where !began {
            pullLockScreen()
            began = onLockScreen("Dinner is served").waitForExistence(timeout: beginning / 3)
            if !began { leaveLockScreen() }
        }
        keepCard("ios-layout-later", showing: "Dinner is served", within: retry)
        leaveLockScreen()
        end("Scheduled start")
    }

    /// The Dynamic Island on the Home Screen: compact, and expanded after a long press.
    func test6TheDynamicIsland() {
        launch()
        start("Dynamic Island")
        XCUIDevice.shared.press(.home)
        XCTAssertTrue(holds(within: system) { app.state != .runningForeground }, "the app leaves the foreground")
        XCTAssertTrue(island.firstMatch.waitForExistence(timeout: system), "the Home Screen shows no Dynamic Island")
        keepIsland("ios-island-compact", after: settling)
        island.firstMatch.press(forDuration: 1.2)
        keepIsland("ios-island-expanded", after: 0.8)
        // The app in front folds the island again.
        XCTAssertTrue(open("Dynamic Island"), "the Dynamic Island example still runs")
        end("Dynamic Island")
    }

    /// Developer tools, with the lifecycle test passed.
    func test7DeveloperTools() {
        launch()
        tap("Developer tools")
        tap("Run lifecycle test")
        XCTAssertTrue(webText("Integration test: passed.").waitForExistence(timeout: selfTest), app.debugDescription)
        // The part is closed and opened once: that takes the pointer off the button. The picture ends above the
        // line that says where the report was saved, a path of this Mac.
        tap("Developer tools")
        tap("Developer tools")
        scroll(webText("Lifecycle integration test"), to: statusBar + 330)
        keepPage("ios-demo-tools")
    }
}
