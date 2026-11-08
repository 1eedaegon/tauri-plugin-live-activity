import ActivityKit
import Foundation
import UIKit
import Tauri
import LiveActivityShared
import LiveActivityCore

private struct PermissionRequest: Decodable { let kind: String }
/// `plugins.live-activity` of the Tauri configuration; null when the app sets none.
private struct PluginConfig: Decodable { let receipts: ReceiptMode? }
private struct ActionRegistration: Decodable { let channel: Channel }
private struct Registered: Encodable {}
private struct ImageFolder: Encodable { let path: String }

/// Both contract versions keep their receipts in one store.
@MainActor
private struct Controllers {
    let templates: LiveActivityController
    let layouts: LayoutActivityController
}

public final class LiveActivityPlugin: Plugin {
    /// Created with the plugin, not in `load(webview:)`: when the system launches the app for a button tap,
    /// no web view and no Tauri `setup()` may follow.
    private let actions = ActionHub()
    private var controllers: Controllers?

    @objc public func getCapabilities(_ invoke: Invoke) {
        let available: Bool
        if #available(iOS 16.1, *) { available = platformSupported } else { available = false }
        let buttons: Bool
        if #available(iOS 17.0, *) { buttons = available } else { buttons = false }
        let supported = available ? "supported" : "unsupported"
        let result = Capabilities(backend: available ? "activityKit" : "unsupported", start: supported,
            update: supported, end: supported, progress: supported, timer: supported, actions: buttons ? "supported" : "unsupported",
            stateObservation: supported, silentUpdate: supported, nativeLiveActivity: supported, layout: supported)
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
        run(invoke) { try await $0.templates.start(invoke.parseArgs(StartRequest.self)) }
    }
    @objc public func update(_ invoke: Invoke) {
        run(invoke) { try await $0.templates.update(invoke.parseArgs(UpdateRequest.self)) }
    }
    @objc public func end(_ invoke: Invoke) {
        run(invoke) { try await $0.templates.end(invoke.parseArgs(EndRequest.self)) }
    }
    @objc public func list(_ invoke: Invoke) {
        run(invoke) { try await $0.templates.list() }
    }

    @objc public func startLayout(_ invoke: Invoke) {
        run(invoke) { try await $0.layouts.start(invoke.parseArgs(LayoutRequest.self)) }
    }
    @objc public func updateLayout(_ invoke: Invoke) {
        run(invoke) { try await $0.layouts.update(invoke.parseArgs(LayoutUpdateRequest.self)) }
    }
    @objc public func endLayout(_ invoke: Invoke) {
        run(invoke) { try await $0.layouts.end(invoke.parseArgs(LayoutEndRequest.self)) }
    }
    @objc public func listLayout(_ invoke: Invoke) {
        run(invoke) { try await $0.layouts.list() }
    }

    /// The folder where Rust writes the PNGs of `write_image`: in the App Group container that the widget extension's
    /// Info.plist names, so the widget reads what the app wrote.
    @objc public func imageDirectory(_ invoke: Invoke) {
        do {
            let folder = try LayoutWidgetPreflight.imageFolder(plugIns: Bundle.main.builtInPlugInsURL) {
                FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: $0)
            }
            invoke.resolve(Success(data: ImageFolder(path: folder.path)))
        } catch { fail(invoke, error) }
    }

    /// Takes the channel that carries button taps to Rust. Rust sends it once, from plugin setup on the main
    /// thread, and waits for the reply, so this resolves on the ipc queue and never waits for the main actor.
    @objc public func registerActions(_ invoke: Invoke) {
        do {
            let channel = try invoke.parseArgs(ActionRegistration.self).channel
            actions.register { action in try? channel.send(action) }
            invoke.resolve(Success(data: Registered()))
        } catch { fail(invoke, error) }
    }

    private func run<Value: Encodable>(_ invoke: Invoke, operation: @escaping @MainActor (Controllers) async throws -> Value) {
        Task { @MainActor in
            do {
                guard #available(iOS 16.1, *), self.platformSupported else {
                    throw ActivityFailure("UNSUPPORTED_PLATFORM", "Live Activities require iPhone with iOS 16.1 or iPad with iPadOS 17 or later.")
                }
                invoke.resolve(Success(data: try await operation(try self.makeControllers())))
            } catch { fail(invoke, error) }
        }
    }

    /// Created on the first command, with the receipt mode of the plugin configuration.
    @available(iOS 16.1, *)
    @MainActor private func makeControllers() throws -> Controllers {
        if let controllers { return controllers }
        let store = try FileReceiptStore.applicationStore(mode: receiptMode())
        let created = Controllers(templates: LiveActivityController(backend: ActivityKitBackend(), store: store),
                                  layouts: LayoutActivityController(backend: LayoutActivityKitBackend(), store: store))
        controllers = created
        return created
    }

    private func receiptMode() throws -> ReceiptMode {
        do { return try parseConfig(PluginConfig?.self)?.receipts ?? .full }
        catch { throw ActivityFailure("CONFIGURATION_REQUIRED", "Invalid live-activity plugin configuration.") }
    }

    private func fail(_ invoke: Invoke, _ error: Error) {
        invoke.resolve(Failure(error))
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
    let actions: String
    let stateObservation: String
    let silentUpdate: String
    let nativeLiveActivity: String
    let maxPayloadBytes = 4096
    let layout: String
}

@_cdecl("init_plugin_live_activity")
public func initPlugin() -> Plugin { LiveActivityPlugin() }
