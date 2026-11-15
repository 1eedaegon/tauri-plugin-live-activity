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

/** Android 12, from which an exact alarm needs a permission and the system has a setting for it. */
private const val EXACT_ALARM_PERMISSION_API = 31

/** What a request to open the setting for exact alarms comes to. */
internal enum class ExactAlarmSetting { Open, NothingToAllow, NotDeclared, NotOnScreen }

/**
 * Android 12 put exact alarms behind a permission that the person gives in a setting of its own, which lists the
 * apps whose manifest asks for `SCHEDULE_EXACT_ALARM`. Where the app may set an exact alarm there is nothing to
 * allow: before Android 12, and with the permission, where all that the person could do in the setting is take it
 * back, which stops the app. An app that the setting does not list has to declare the permission first, and
 * Android opens another screen only for an app that is on screen.
 */
internal fun exactAlarmSetting(sdk: Int, allowed: Boolean, declared: Boolean, onScreen: Boolean): ExactAlarmSetting = when {
    sdk < EXACT_ALARM_PERMISSION_API || allowed -> ExactAlarmSetting.NothingToAllow
    !declared -> ExactAlarmSetting.NotDeclared
    !onScreen -> ExactAlarmSetting.NotOnScreen
    else -> ExactAlarmSetting.Open
}

/**
 * The calls that wait for one visit of a setting. The first opens it. One that comes while it is open waits with
 * the first: Tauri keeps one activity result for the whole process, so a second opening would leave the first call
 * without an answer. All are answered together, when the person is back or when the setting did not open.
 */
internal class SettingVisit<T> {
    private val waiting = mutableListOf<T>()

    /**
     * Takes [call] in when the setting is open, to wait with the call that opened it. False when it is not open:
     * the call is then judged as a first one.
     */
    @Synchronized
    fun joinIfOpen(call: T): Boolean = waiting.isNotEmpty() && waiting.add(call)

    /** Takes [call] in. True when it is the first, which has to open the setting. */
    @Synchronized
    fun join(call: T): Boolean {
        waiting.add(call)
        return waiting.size == 1
    }

    /** The calls that waited, for their answer. None waits afterwards. */
    @Synchronized
    fun end(): List<T> = waiting.toList().also { waiting.clear() }
}

/**
 * Whether the app may set an exact alarm now, as liveupdate's adapter observes it for its `capabilities`
 * (`presentation.exactStart`): the plugin asks the alarm manager nowhere else, so it agrees with the alarm that
 * liveupdate sets. A reply without the member is a failure of the native side, never a guess.
 */
internal fun exactAlarmsAllowed(observed: JSONObject): Boolean =
    observed.optJSONObject("presentation")?.opt("exactStart") as? Boolean
        ?: throw ActivityFailure("NATIVE_ERROR", "The setting for exact alarms could not be read.")
