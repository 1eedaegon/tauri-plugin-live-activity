package io.github.eedaegon.liveactivity

internal fun notificationPermissionState(
    sdk: Int,
    notificationsAllowed: Boolean,
    runtimeGranted: Boolean,
    frameworkState: String?,
    shouldShowRationale: Boolean = false,
    observedDenial: Boolean = false,
): String = when {
    notificationsAllowed -> "granted"
    sdk < 33 || runtimeGranted -> "settingsRequired"
    shouldShowRationale -> "prompt"
    observedDenial -> "settingsRequired"
    frameworkState == "denied" -> "unknown"
    else -> "prompt"
}
