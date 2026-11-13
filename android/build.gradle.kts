import org.jetbrains.kotlin.gradle.dsl.JvmTarget
import org.gradle.testing.jacoco.tasks.JacocoReport
import org.gradle.testing.jacoco.tasks.JacocoCoverageVerification

plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("jacoco")
}

android {
    namespace = "io.github.eedaegon.liveactivity"
    compileSdk = 37
    defaultConfig {
        // Tauri's Jackson runtime requires BootstrapMethodError (Android 8/API 26).
        minSdk = 26
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        consumerProguardFiles("consumer-rules.pro")
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_1_8
        targetCompatibility = JavaVersion.VERSION_1_8
    }
    testOptions {
        unitTests.isReturnDefaultValues = true
    }
    sourceSets {
        // The Android contents that the TypeScript declarations and the Rust models are compared with, for the
        // device tests (NativeBridgeTest). The folder is the repository's: a packaged crate has neither.
        getByName("androidTest").assets.srcDir("../tests/fixtures/android")
    }
    buildTypes {
        debug {
            val collectCoverage = providers.gradleProperty("liveActivityCoverage").orNull == "true"
            enableAndroidTestCoverage = collectCoverage
            enableUnitTestCoverage = collectCoverage
        }
    }
}

kotlin { compilerOptions { jvmTarget = JvmTarget.JVM_1_8 } }

dependencies {
    implementation(project(":tauri-android"))
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20260814")
    androidTestImplementation("androidx.test.ext:junit:1.3.0")
    androidTestImplementation("androidx.test:runner:1.7.0")
    androidTestImplementation("com.fasterxml.jackson.core:jackson-databind:2.15.3")
}


// liveupdate's adapter is copied from its crate and tested there (tools/sync-liveupdate.mjs); the gate counts the
// plugin's own classes.
val coverageClasses = fileTree(layout.buildDirectory.dir("tmp/kotlin-classes/debug")) {
    exclude("io/github/eedaegon/liveupdate/**")
}
val coverageData = fileTree(layout.buildDirectory) {
    include("outputs/unit_test_code_coverage/**/*.exec", "outputs/code_coverage/**/*.ec")
}

tasks.register<JacocoReport>("coverageReport") {
    dependsOn("testDebugUnitTest", "connectedDebugAndroidTest")
    classDirectories.setFrom(coverageClasses)
    sourceDirectories.setFrom(files("src/main/java"))
    executionData.setFrom(coverageData)
    reports { xml.required.set(true); html.required.set(true) }
}

tasks.register<JacocoCoverageVerification>("coverageVerification") {
    dependsOn("coverageReport")
    classDirectories.setFrom(coverageClasses)
    executionData.setFrom(coverageData)
    violationRules { rule { limit { counter = "LINE"; minimum = "0.80".toBigDecimal() } } }
}
