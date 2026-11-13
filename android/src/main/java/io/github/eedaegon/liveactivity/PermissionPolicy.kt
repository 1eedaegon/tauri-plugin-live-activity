package io.github.eedaegon.liveactivity

import org.json.JSONException
import org.json.JSONObject

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

/** Whether a request for notifications shows Android's dialog: only while Android can still ask. */
internal fun dialogCanAsk(notifications: String): Boolean = notifications == "prompt" || notifications == "unknown"

/** The members of liveupdate's `capabilities` that the permissions read. */
private val OBSERVED_SETTINGS = listOf("supported", "notificationsEnabled", "promotionEnabled")

/**
 * What liveupdate's adapter observes of the notification settings, out of its reply to `capabilities`. A reply
 * without the three settings is a failure of the native side, never a guess.
 */
internal fun observedSettings(reply: String): JSONObject {
    val observed = try { JSONObject(reply).optJSONObject("data") } catch (_: JSONException) { null }
    if (observed == null || OBSERVED_SETTINGS.any { observed.opt(it) !is Boolean }) {
        throw ActivityFailure("NATIVE_ERROR", "The notification settings could not be read.")
    }
    return observed
}

/**
 * The plugin's permissions from what liveupdate's adapter observes (`supported` where Android promotes
 * notifications, `promotionEnabled` where the settings allow it) and the state of the notification permission.
 * Android has neither Live Activities nor pushes of them.
 */
internal fun permissionsOf(observed: JSONObject, notifications: String): JSONObject = JSONObject()
    .put("notifications", notifications)
    .put("liveActivities", "notApplicable")
    .put("promotion", when {
        !observed.getBoolean("supported") -> "notApplicable"
        observed.getBoolean("promotionEnabled") -> "granted"
        else -> "settingsRequired"
    })
    .put("frequentPushes", "notApplicable")
