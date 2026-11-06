import Foundation
import LiveActivityShared

/// What the plugin would send to Rust: the taps that reach the production `ActionHub`, and whether the
/// hub delivered them on the main thread.
final class ActionProbe {
    typealias Tap = (action: LiveActivityAction, onMainThread: Bool)
    private let hub = ActionHub()
    private let lock = NSLock()
    private var taps: [Tap] = []

    init() {
        hub.register { [weak self] action in self?.record((action, Thread.isMainThread)) }
    }

    private func record(_ tap: Tap) {
        lock.lock(); defer { lock.unlock() }
        taps.append(tap)
    }

    private var firstTap: Tap? {
        lock.lock(); defer { lock.unlock() }
        return taps.first
    }

    /// The first tap that arrives within `seconds`.
    func first(within seconds: Int) async -> Tap? {
        for _ in 0..<(seconds * 10) {
            if let tap = firstTap { return tap }
            try? await Task.sleep(nanoseconds: 100_000_000)
        }
        return nil
    }
}

extension ActivityTestApp {
    /// A lock screen with a symbol, a title, a bound status, a progress bar, a timer and a Stop button.
    static func layoutRequest(startedAt: Int64) throws -> LayoutRequest {
        let json = #"""
        {"activityKey":"native-layout-test","schemaVersion":2,"fallback":"none",
         "layout":{
          "lockScreen":{"type":"vstack","alignment":"leading","spacing":8,"style":"card","children":[
            {"type":"hstack","spacing":6,"children":[
              {"type":"symbol","name":"bolt.fill","style":"accent"},
              {"type":"text","value":"Layout activity","style":"title"}]},
            {"type":"text","bind":"status"},
            {"type":"progress","bind":"done","style":"meter"},
            {"type":"hstack","children":[
              {"type":"timerText","start":"startedAt","end":"endsAt","style":"timer"},
              {"type":"button","actionId":"stop","style":"action","child":{"type":"text","value":"Stop"}}]}]},
          "island":{
            "expanded":{
              "leading":{"type":"symbol","name":"bolt.fill","style":"accent"},
              "center":{"type":"text","bind":"status"},
              "bottom":{"type":"button","actionId":"stop","style":"action","child":{"type":"text","value":"Stop"}}},
            "compactTrailing":{"type":"progress","bind":"done","kind":"circular","style":"meter"}},
          "background":{"light":"#F2F2F7","dark":"#1C1C1E"},
          "keyline":"orange"},
         "styles":{
          "card":{"padding":16},
          "title":{"font":"headline","lineLimit":1},
          "accent":{"color":"orange"},
          "meter":{"tint":"orange"},
          "timer":{"font":"caption","monospacedDigit":true},
          "action":{"buttonStyle":"borderedProminent","tint":"orange"}},
         "snapshot":{"revision":0,"values":{"status":"Step 1 of 3","done":0.33,"startedAt":\#(startedAt),"endsAt":\#(startedAt + 600_000)}}}
        """#
        return try JSONDecoder().decode(LayoutRequest.self, from: Data(json.utf8))
    }

    @MainActor func runLayout() async {
        do {
            try await Task.sleep(nanoseconds: 1_000_000_000)
            let store = try FileReceiptStore.applicationStore(mode: .redacted)
            let controller = LayoutActivityController(backend: LayoutActivityKitBackend(), store: store)
            let request = try Self.layoutRequest(startedAt: Int64(Date().timeIntervalSince1970 * 1000))
            try await endLeftovers(controller, store: store)
            let first = try await controller.start(request)
            let duplicate = try await controller.start(request)
            guard first.id == duplicate.id, first.id.hasPrefix("la-ios-layout-") else { throw ActivityFailure("TEST_FAILED", "Duplicate layout start") }
            status = "Layout activity started"
            write(["stage": "started", "id": first.id])
            try await Task.sleep(nanoseconds: 3_000_000_000)
            var values = request.snapshot.values
            values["status"] = .string("Step 2 of 3")
            values["done"] = .number(0.66)
            _ = try await controller.update(LayoutUpdateRequest(id: first.id, snapshot: LayoutSnapshot(revision: 1, values: values)))
            try await expectRecovery(of: first.id, store: store)
            try expectRedactedReceipt(of: first.id)
            status = "Layout activity updated; inspect Lock Screen"
            write(["stage": "updated", "id": first.id])
            guard let tap = await actions.first(within: 120) else { throw ActivityFailure("TEST_FAILED", "No button action arrived") }
            let expected = LiveActivityAction(activityId: first.id, actionId: "stop", activityKey: "native-layout-test")
            guard tap.action == expected, !tap.onMainThread else { throw ActivityFailure("TEST_FAILED", "Unexpected button action") }
            status = "Action stop arrived"
            write(["stage": "action", "id": first.id, "actionId": tap.action.actionId])
            let end = LayoutEndRequest(id: first.id, policy: EndPolicy(kind: "immediate", at: nil))
            _ = try await controller.end(end)
            _ = try await controller.end(end)
            do {
                _ = try await controller.update(LayoutUpdateRequest(id: first.id, snapshot: LayoutSnapshot(revision: 2, values: values)))
                throw ActivityFailure("TEST_FAILED", "Ended layout activity accepted update")
            } catch let error as ActivityFailure where error.code == "NOT_FOUND" {}
            status = "PASS: layout start, duplicate, update, recovery, redacted receipt, action, end, no resurrection"
            write(["stage": "passed", "checks": "8"])
        } catch { report(error) }
    }

    /// Ends the activities that earlier runs left when the test runner stopped the app. The Lock Screen stacks
    /// an app's activities, so a leftover card would hide this run's texts; its timer also differs.
    @MainActor private func endLeftovers(_ layouts: LayoutActivityController, store: FileReceiptStore) async throws {
        let now = EndPolicy(kind: "immediate", at: nil)
        for leftover in try await layouts.list() where leftover.state == "active" {
            _ = try await layouts.end(LayoutEndRequest(id: leftover.id, policy: now))
        }
        let templates = LiveActivityController(backend: ActivityKitBackend(), store: store)
        for leftover in try await templates.list() where leftover.state == "active" {
            _ = try await templates.end(EndRequest(id: leftover.id, policy: now))
        }
    }

    /// A second controller on the same store sees the update once ActivityKit publishes it: a redacted
    /// receipt holds no snapshot to report in the meantime.
    @MainActor private func expectRecovery(of id: String, store: FileReceiptStore) async throws {
        let restored = LayoutActivityController(backend: LayoutActivityKitBackend(), store: store)
        for _ in 0..<50 {
            if try await restored.list().contains(where: { $0.id == id && $0.snapshot.revision == 1 }) { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw ActivityFailure("TEST_FAILED", "Layout OS state recovery")
    }

    /// The receipt file knows the activity but holds none of its text.
    private func expectRedactedReceipt(of id: String) throws {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: false)
        let file = try String(contentsOf: support.appendingPathComponent("tauri-live-activity/receipts-v2.json"), encoding: .utf8)
        guard file.contains(id), !file.contains("Step") else { throw ActivityFailure("TEST_FAILED", "Receipt is not redacted") }
    }
}
