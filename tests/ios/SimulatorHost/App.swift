import SwiftUI
import LiveActivityShared

/// Runs one scenario per launch: the v1 template lifecycle by default, `-scenario layout` for a layout
/// activity with a button, `-scenario fixtures` for every layout fixture through the plugin path and the interpreter.
@main
struct ActivityTestApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @State private var started = false
    @State var status = "Waiting for foreground"
    /// Observes button taps from launch, as the plugin does from its initializer.
    let actions = ActionProbe()
    var body: some Scene {
        WindowGroup {
            VStack(spacing: 20) {
                Text("Live Activity native tests").font(.title)
                Text(status).accessibilityIdentifier("native-test-status")
            }
            .padding()
            .onChange(of: scenePhase) { phase in
                if phase == .active && !started {
                    started = true
                    Task { await run() }
                }
            }
        }
    }
    @MainActor func write(_ values: [String: String]) {
        do {
            let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("result.json")
            try JSONSerialization.data(withJSONObject: values, options: [.sortedKeys]).write(to: url, options: .atomic)
        } catch { status = "Could not write test result" }
    }
    @MainActor func report(_ error: Error) {
        if let error = error as? ActivityFailure {
            status = error.code + ": " + error.message
            write(["stage": "failed", "code": error.code, "message": error.message])
        } else {
            status = "Unexpected native failure"
            write(["stage": "failed", "code": "UNEXPECTED"])
        }
    }
    @MainActor private func run() async {
        switch UserDefaults.standard.string(forKey: "scenario") {
        case "layout": await runLayout()
        case "fixtures": await runFixtures()
        default: await runTemplate()
        }
    }
    @MainActor private func runTemplate() async {
        do {
            try await Task.sleep(nanoseconds: 1_000_000_000)
            let controller = LiveActivityController(backend: ActivityKitBackend(), store: try FileReceiptStore.applicationStore())
            let firstState = ActivitySnapshot(revision: 0, title: "Downloading files", status: "25 of 100 files", progress: 0.25, timer: nil, staleAt: nil)
            let request = StartRequest(activityKey: "native-test", schemaVersion: 1, template: "progress", fallback: "none", snapshot: firstState)
            let first = try await controller.start(request)
            let duplicate = try await controller.start(request)
            guard first.id == duplicate.id else { throw ActivityFailure("TEST_FAILED", "Duplicate start") }
            status = "Activity started"
            write(["stage": "started", "id": first.id])
            try await Task.sleep(nanoseconds: 3_000_000_000)
            let next = ActivitySnapshot(revision: 1, title: "Downloading files", status: "65 of 100 files", progress: 0.65, timer: nil, staleAt: nil)
            _ = try await controller.update(UpdateRequest(id: first.id, snapshot: next))
            let restored = LiveActivityController(backend: ActivityKitBackend(), store: try FileReceiptStore.applicationStore())
            let observed = try await restored.list()
            guard observed.contains(where: { $0.id == first.id && $0.snapshot.revision == 1 }) else {
                throw ActivityFailure("TEST_FAILED", "OS state recovery")
            }
            status = "Activity updated; inspect Lock Screen"
            write(["stage": "updated", "id": first.id])
            try await Task.sleep(nanoseconds: 45_000_000_000)
            _ = try await controller.end(EndRequest(id: first.id, policy: EndPolicy(kind: "immediate", at: nil)))
            _ = try await controller.end(EndRequest(id: first.id, policy: EndPolicy(kind: "immediate", at: nil)))
            do {
                _ = try await controller.update(UpdateRequest(id: first.id, snapshot: next))
                throw ActivityFailure("TEST_FAILED", "Ended activity accepted update")
            } catch let error as ActivityFailure where error.code == "NOT_FOUND" {}
            status = "PASS: start, duplicate, update, OS recovery, end, no resurrection"
            write(["stage": "passed", "checks": "6"])
        } catch { report(error) }
    }
}
