import Foundation
#if canImport(LiveActivityShared)
import LiveActivityShared
#endif

@MainActor
public protocol ActivityReceiptStore {
    func load() throws -> [NativeActivity]
    func save(_ activities: [NativeActivity]) throws
}

/// Accepted snapshots are persisted because ActivityKit's read model can lag an awaited update.
@MainActor
public struct FileReceiptStore: ActivityReceiptStore {
    private let url: URL
    private let maxBytes = 1_048_576
    public init(url: URL) { self.url = url }
    public static func applicationStore() throws -> FileReceiptStore {
        let directory = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        return FileReceiptStore(url: directory.appendingPathComponent("tauri-live-activity/receipts-v1.json"))
    }
    public func load() throws -> [NativeActivity] {
        guard FileManager.default.fileExists(atPath: url.path) else { return [] }
        do {
            let handle = try FileHandle(forReadingFrom: url)
            defer { try? handle.close() }
            let data = try handle.read(upToCount: maxBytes + 1) ?? Data()
            guard data.count <= maxBytes else { throw ActivityFailure("NATIVE_ERROR", "Activity receipt storage is too large.") }
            let receipts = try JSONDecoder().decode([NativeActivity].self, from: data)
            guard receipts.count <= 256 else { throw ActivityFailure("NATIVE_ERROR", "Too many activity receipts.") }
            for receipt in receipts { try receipt.snapshot.validate(template: receipt.attributes.template) }
            return receipts
        } catch { throw ActivityFailure("NATIVE_ERROR", "Unable to read local activity receipts.") }
    }
    public func save(_ activities: [NativeActivity]) throws {
        do {
            let directory = url.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let data = try JSONEncoder().encode(activities)
            guard data.count <= maxBytes else { throw ActivityFailure("NATIVE_ERROR", "Activity receipt storage is too large.") }
            #if os(iOS)
            try data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            #else
            try data.write(to: url, options: .atomic)
            #endif
            try FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
        } catch { throw ActivityFailure("NATIVE_ERROR", "Unable to save local activity receipts.") }
    }
}
