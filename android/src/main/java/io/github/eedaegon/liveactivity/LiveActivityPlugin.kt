package io.github.eedaegon.liveactivity

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import app.tauri.annotation.Command
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")])
class LiveActivityPlugin(private val activity: Activity) : Plugin(activity) {
    private val notifications = AndroidNotifications(activity)
    private val engine = ActivityEngine(PreferencesStore(activity), notifications)
    private val preferences = activity.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    @Command
    fun getCapabilities(invoke: Invoke) = respond(invoke) {
        JSONObject().put("platform", "android").put("backend", "androidNotification")
            .put("start", "supported").put("update", "supported").put("end", "supported")
            .put("progress", "supported").put("timer", "supported").put("actions", "unsupported")
            .put("stateObservation", "supported").put("silentUpdate", "supported")
            .put("nativeLiveActivity", if (notifications.promotionAllowed()) "supported" else "unsupported")
            .put("maxPayloadBytes", 4096)
    }

    @Command
    override fun checkPermissions(invoke: Invoke) = respond(invoke) { permissions() }

    @Command
    override fun requestPermissions(invoke: Invoke) {
        try {
            val args = invoke.getArgs()
            Input.keys(args, setOf("kind"))
            val kind = args.get("kind")
            if (kind !in listOf("notifications", "liveActivities", "promotion")) {
                throw ActivityFailure("INVALID_INPUT", "Unknown permission kind.")
            }
            if (kind == "notifications" && notificationPermission() in listOf("prompt", "unknown")) {
                requestPermissionForAlias("notifications", invoke, "permissionResult")
            } else respond(invoke) { permissions() }
        } catch (error: Exception) { failure(invoke, error) }
    }

    @PermissionCallback
    private fun permissionResult(invoke: Invoke) = respond(invoke) {
        val granted = activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED
        val rationale = activity.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)
        if (granted || rationale) {
            if (!preferences.edit().putBoolean("permissionDenialObserved", !granted).commit()) {
                throw ActivityFailure("NATIVE_ERROR", "Permission result could not be saved.")
            }
        }
        permissions()
    }

    @Command
    fun start(invoke: Invoke) = respond(invoke) { engine.start(Input.start(invoke.getArgs())).json() }

    @Command
    fun update(invoke: Invoke) = respond(invoke) {
        val args = invoke.getArgs()
        Input.keys(args, setOf("id", "snapshot"))
        engine.update(Input.id(args.get("id")), Input.snapshot(args.getJSONObject("snapshot"))).json()
    }

    @Command
    fun end(invoke: Invoke) = respond(invoke) {
        val (id, policy) = Input.end(invoke.getArgs())
        engine.end(id, policy).json()
    }

    @Command
    fun list(invoke: Invoke) = respond(invoke) { JSONArray(engine.list().map { it.json() }) }

    private fun permissions(): JSONObject = JSONObject().put("notifications", notificationPermission())
        .put("liveActivities", "notApplicable")
        .put("promotion", when {
            Build.VERSION.SDK_INT < 36 -> "notApplicable"
            notifications.promotionAllowed() -> "granted"
            else -> "settingsRequired"
        })

    // Tauri can cache DENIED for a cancelled dialog. Only an observed rationale proves
    // a previous denial; otherwise report uncertainty and allow an explicit retry.
    private fun notificationPermission(): String = notificationPermissionState(
        Build.VERSION.SDK_INT,
        notifications.notificationsAllowed(),
        Build.VERSION.SDK_INT < 33 || activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED,
        getPermissionState("notifications")?.toString(),
        Build.VERSION.SDK_INT >= 33 && activity.shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS),
        preferences.getBoolean("permissionDenialObserved", false),
    )

    private fun respond(invoke: Invoke, action: () -> Any) {
        try { invoke.resolve(JSObject().put("ok", true).put("data", action()) as JSObject) }
        catch (error: Exception) { failure(invoke, error) }
    }

    private fun failure(invoke: Invoke, error: Exception) {
        val failure = when (error) {
            is ActivityFailure -> error
            is JSONException -> ActivityFailure("INVALID_INPUT", "Invalid activity request.")
            is SecurityException -> ActivityFailure("PERMISSION_DENIED", "Android denied the notification operation.")
            else -> ActivityFailure("NATIVE_ERROR", "The Android activity operation failed.")
        }
        val json = JSONObject().put("code", failure.code).put("message", failure.message)
        invoke.resolve(JSObject().put("ok", false).put("error", json) as JSObject)
    }
}
