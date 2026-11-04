// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "tauri-plugin-live-activity",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "tauri-plugin-live-activity", type: .static, targets: ["LiveActivityPlugin"]),
        .library(name: "LiveActivityShared", targets: ["LiveActivityShared"])
    ],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [
        .target(name: "LiveActivityShared", path: "Sources/LiveActivityShared"),
        .target(name: "LiveActivityCore", dependencies: ["LiveActivityShared"], path: "Sources/LiveActivityCore"),
        .target(name: "LiveActivityPlugin", dependencies: ["Tauri", "LiveActivityShared", "LiveActivityCore"], path: "Sources/LiveActivityPlugin")
    ]
)
