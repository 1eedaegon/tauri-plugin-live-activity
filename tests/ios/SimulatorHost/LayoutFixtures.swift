import AppIntents
import SwiftUI
import LiveActivityShared
import LiveActivityUI

/// A backend that ActivityKit never sees: a fixture start that passes every check of the plugin path ends here.
@MainActor
private final class FixtureLayoutBackend: LayoutActivityBackend {
    static let reached = "REACHED_ACTIVITYKIT"
    func preflightStart() throws {}
    func preflightLayoutWidget() throws {}
    func list() async -> [LayoutActivity] { [] }
    func start(_ attributes: LiveActivityLayoutAttributes, snapshot: LayoutSnapshot) async throws -> LayoutActivity {
        throw ActivityFailure(Self.reached, "The request passed every plugin check.")
    }
    func update(_ activity: LayoutActivity, snapshot: LayoutSnapshot) async throws -> LayoutActivity { throw ActivityFailure(Self.reached, "") }
    func end(_ activity: LayoutActivity, policy: EndPolicy) async throws -> LayoutActivity { throw ActivityFailure(Self.reached, "") }
}

@MainActor
private final class FixtureTemplateBackend: ActivityBackend {
    func preflightStart() throws {}
    func list() async -> [NativeActivity] { [] }
    func start(_ attributes: LiveActivityAttributes, snapshot: ActivitySnapshot) async throws -> NativeActivity {
        throw ActivityFailure(FixtureLayoutBackend.reached, "")
    }
    func update(_ activity: NativeActivity, snapshot: ActivitySnapshot) async throws -> NativeActivity { throw ActivityFailure(FixtureLayoutBackend.reached, "") }
    func end(_ activity: NativeActivity, policy: EndPolicy) async throws -> NativeActivity { throw ActivityFailure(FixtureLayoutBackend.reached, "") }
}

private extension LayoutRegion {
    /// Roughly the size of the presentation on a 393-point-wide iPhone.
    var canvas: CGSize {
        switch self {
        case .lockScreen, .expandedBottom: return CGSize(width: 360, height: 160)
        case .expandedLeading, .expandedTrailing: return CGSize(width: 90, height: 60)
        case .expandedCenter: return CGSize(width: 180, height: 60)
        case .compactLeading, .compactTrailing: return CGSize(width: 52, height: 36)
        case .minimal: return CGSize(width: 36, height: 36)
        }
    }
}

extension ActivityTestApp {
    /// Every case of tests/fixtures/layout-requests.json through the plugin path (argument decoding, controller,
    /// reply mapping), and every region of every valid start through the interpreter.
    @MainActor func runFixtures() async {
        do {
            guard let url = Bundle.main.url(forResource: "layout-requests", withExtension: "json"),
                  let fixtures = try JSONSerialization.jsonObject(with: Data(contentsOf: url)) as? [String: [[String: Any]]],
                  let valid = fixtures["valid"], let invalid = fixtures["invalid"] else { throw ActivityFailure("TEST_FAILED", "Unreadable layout fixtures") }
            status = "Checking layout fixtures"
            var rendered = 0, lenient = 0, rustOnly = 0
            for fixture in valid {
                let (name, command, input) = try read(fixture)
                guard accepts(command, input, await reply(command, input)) else { throw ActivityFailure("TEST_FAILED", "Valid fixture: " + name) }
                if command == "start_layout" {
                    let request = try JSONDecoder().decode(LayoutRequest.self, from: input)
                    guard render(request) else { throw ActivityFailure("TEST_FAILED", "Not rendered: " + name) }
                    rendered += LayoutRegion.allCases.count
                }
            }
            for fixture in invalid {
                let (name, command, input) = try read(fixture)
                guard let code = fixture["code"] as? String else { throw ActivityFailure("TEST_FAILED", "Fixture without a code: " + name) }
                let verdict = await reply(command, input)
                if verdict?.code == code { continue }
                if ["start", "update"].contains(command), try dropsMembers(command, input) { lenient += 1; continue }
                if verdict == nil, code == "INVALID_INPUT" { rustOnly += 1; continue }
                throw ActivityFailure("TEST_FAILED", "Invalid fixture: " + name)
            }
            guard lenient <= 2, rustOnly <= 2 else { throw ActivityFailure("TEST_FAILED", "Too many fixtures pass the native layer") }
            status = "PASS: layout fixtures, \(valid.count) valid, \(invalid.count) invalid, \(rendered) regions rendered"
            write(["stage": "passed", "valid": String(valid.count), "invalid": String(invalid.count), "rendered": String(rendered),
                   "lenient": String(lenient), "rustOnly": String(rustOnly)])
        } catch { report(error) }
    }

    private func read(_ fixture: [String: Any]) throws -> (name: String, command: String, input: Data) {
        guard let name = fixture["name"] as? String, let command = fixture["command"] as? String, let input = fixture["input"] else {
            throw ActivityFailure("TEST_FAILED", "Malformed layout fixture")
        }
        return (name, command, try JSONSerialization.data(withJSONObject: input, options: [.fragmentsAllowed]))
    }

    /// The failure the plugin replies with, as `LiveActivityPlugin` decodes and dispatches the command; nil for
    /// a command that only Rust rejects. No handle exists, so a request that passes every check fails as
    /// REACHED_ACTIVITYKIT (start) or NOT_FOUND (update, end).
    @MainActor private func reply(_ command: String, _ input: Data) async -> ActivityFailure? {
        let decoder = JSONDecoder()
        let layouts = LayoutActivityController(backend: FixtureLayoutBackend())
        let templates = LiveActivityController(backend: FixtureTemplateBackend())
        do {
            switch command {
            case "start_layout": _ = try await layouts.start(decoder.decode(LayoutRequest.self, from: input))
            case "update_layout": _ = try await layouts.update(decoder.decode(LayoutUpdateRequest.self, from: input))
            case "end_layout": _ = try await layouts.end(decoder.decode(LayoutEndRequest.self, from: input))
            case "start": _ = try await templates.start(decoder.decode(StartRequest.self, from: input))
            case "update": _ = try await templates.update(decoder.decode(UpdateRequest.self, from: input))
            default: return nil
            }
            return ActivityFailure("TEST_FAILED", "A fixture command succeeded without an activity.")
        } catch {
            return Failure(error).error
        }
    }

    /// Whether the reply to a valid fixture shows that it passed every request check. An `after` dismissal
    /// time is judged against the clock when the activity ends, as in v1.
    private func accepts(_ command: String, _ input: Data, _ reply: ActivityFailure?) -> Bool {
        switch command {
        case "start_layout": return reply?.code == FixtureLayoutBackend.reached
        case "update_layout": return reply?.code == "NOT_FOUND"
        case "end_layout":
            if reply?.code == "NOT_FOUND" { return true }
            let after = (try? JSONDecoder().decode(LayoutEndRequest.self, from: input))?.policy.kind == "after"
            return after && reply?.code == "INVALID_INPUT" && reply?.message == "Dismissal must be within the next four hours."
        default: return false
        }
    }

    /// The frozen v1 decoder ignores unknown members; Rust rejects such bodies before they reach Swift.
    private func dropsMembers(_ command: String, _ input: Data) throws -> Bool {
        let decoded: Data = command == "start"
            ? try JSONEncoder().encode(JSONDecoder().decode(StartRequest.self, from: input))
            : try JSONEncoder().encode(JSONDecoder().decode(UpdateRequest.self, from: input))
        func members(_ value: Any) -> Int {
            if let object = value as? [String: Any] { return object.values.reduce(object.count) { $0 + members($1) } }
            if let list = value as? [Any] { return list.reduce(0) { $0 + members($1) } }
            return 0
        }
        return members(try JSONSerialization.jsonObject(with: decoded)) < members(try JSONSerialization.jsonObject(with: input))
    }

    /// Draws every region with the template's button wrapper; each must produce an image of its canvas size.
    @MainActor private func render(_ request: LayoutRequest) -> Bool {
        LayoutRegion.allCases.allSatisfy { region in
            let view = LayoutView(document: request.document, values: request.snapshot.values, region: region, button: Self.button)
                .frame(width: region.canvas.width, height: region.canvas.height)
            let renderer = ImageRenderer(content: view)
            renderer.scale = 1
            return renderer.uiImage?.size == region.canvas
        }
    }

    private static var button: LayoutView.ButtonBuilder? {
        guard #available(iOS 17.0, *) else { return nil }
        return { actionId, label in
            AnyView(Button(intent: LiveActivityActionIntent(activityId: "fixture", actionId: actionId)) { label })
        }
    }
}
