pluginManagement { repositories { google(); mavenCentral(); gradlePluginPortal() } }
rootProject.name = "live-activity-android-tests"
include(":live-activity", ":tauri-android")
project(":live-activity").projectDir = file("../../android")
val cargoHome = System.getenv("CARGO_HOME") ?: "${System.getProperty("user.home")}/.cargo"
val source = file("$cargoHome/registry/src").listFiles()?.asSequence()?.flatMap { it.listFiles()?.asSequence() ?: emptySequence() }
    ?.firstOrNull { it.name == "tauri-2.12.5" }
    ?: error("Run cargo fetch first (Tauri 2.12.5 is required).")
project(":tauri-android").projectDir = source.resolve("mobile/android")
