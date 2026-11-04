import ActivityKit
import Foundation
import UIKit
import Tauri
import LiveActivityShared
import LiveActivityCore

private struct Success<Value: Encodable>: Encodable {
    let ok = true
    let data: Value
}
private struct Failure: Encodable {
    let ok = false
    let error: ActivityFailure
}
private struct PermissionRequest: Decodable { let kind: String }

public final class LiveActivityPlugin: Plugin {
    private var controller: LiveActivityController?

    @objc public func getCapabilities(_ invoke: Invoke) {
        let available: Bool
        if #available(iOS 16.1, *) { available = platformSupported } else { available = false }
        let supported = available ? "supported" : "unsupported"
        let result = Capabilities(backend: available ? "activityKit" : "unsupported", start: supported,
            update: supported, end: supported, progress: supported, timer: supported,
            stateObservation: supported, silentUpdate: supported, nativeLiveActivity: supported)
        invoke.resolve(Success(data: result))
    }

    @objc public override func checkPermissions(_ invoke: Invoke) {
        invoke.resolve(Success(data: permissions(request: false)))
    }

    @objc public override func requestPermissions(_ invoke: Invoke) {
        do {
            let request = try invoke.parseArgs(PermissionRequest.self)
            guard request.kind == "liveActivities" else {
                throw ActivityFailure("UNSUPPORTED_FEATURE", "This backend only exposes Live Activity settings.")
            }
            invoke.resolve(Success(data: permissions(request: true)))
        } catch { fail(invoke, error) }
    }

    @objc public func start(_ invoke: Invoke) {
        run(invoke) { controller in try await controller.start(invoke.parseArgs(StartRequest.self)) }
    }
    @objc public func update(_ invoke: Invoke) {
        run(invoke) { controller in try await controller.update(invoke.parseArgs(UpdateRequest.self)) }
    }
    @objc public func end(_ invoke: Invoke) {
        run(invoke) { controller in try await controller.end(invoke.parseArgs(EndRequest.self)) }
    }
    @objc public func list(_ invoke: Invoke) {
        run(invoke) { controller in try await controller.list() }
    }

    private func run<Value: Encodable>(_ invoke: Invoke, operation: @escaping @MainActor (LiveActivityController) async throws -> Value) {
        Task { @MainActor in
            do {
                guard #available(iOS 16.1, *), self.platformSupported else {
                    throw ActivityFailure("UNSUPPORTED_PLATFORM", "Live Activities require iPhone with iOS 16.1 or iPad with iPadOS 17 or later.")
                }
                let instance = try controller ?? LiveActivityController(backend: ActivityKitBackend(), store: FileReceiptStore.applicationStore())
                controller = instance
                invoke.resolve(Success(data: try await operation(instance)))
            } catch { fail(invoke, error) }
        }
    }

    private func fail(_ invoke: Invoke, _ error: Error) {
        let failure: ActivityFailure
        if let typed = error as? ActivityFailure { failure = typed }
        else if error is DecodingError { failure = ActivityFailure("INVALID_INPUT", "Invalid command arguments.") }
        else { failure = ActivityFailure("NATIVE_ERROR", "The native activity operation failed.") }
        invoke.resolve(Failure(error: failure))
    }

    private func permissions(request: Bool) -> Permissions {
        guard #available(iOS 16.1, *), platformSupported else { return Permissions(liveActivities: "notApplicable") }
        let enabled = ActivityAuthorizationInfo().areActivitiesEnabled
        return Permissions(liveActivities: enabled ? "granted" : (request ? "settingsRequired" : "denied"))
    }

    private var platformSupported: Bool {
        #if targetEnvironment(macCatalyst)
        return false
        #else
        let family: LiveActivityPlatformSupport.DeviceFamily
        switch UIDevice.current.userInterfaceIdiom {
        case .phone: family = .phone
        case .pad: family = .pad
        default: family = .unsupported
        }
        return LiveActivityPlatformSupport.supports(family, version: ProcessInfo.processInfo.operatingSystemVersion,
            isiOSAppOnMac: ProcessInfo.processInfo.isiOSAppOnMac)
        #endif
    }
}

private struct Permissions: Encodable {
    let notifications = "notApplicable"
    let liveActivities: String
    let promotion = "notApplicable"
}
private struct Capabilities: Encodable {
    let platform = "ios"
    let backend: String
    let start: String
    let update: String
    let end: String
    let progress: String
    let timer: String
    let actions = "unsupported"
    let stateObservation: String
    let silentUpdate: String
    let nativeLiveActivity: String
    let maxPayloadBytes = 4096
}

@_cdecl("init_plugin_live_activity")
public func initPlugin() -> Plugin { LiveActivityPlugin() }
