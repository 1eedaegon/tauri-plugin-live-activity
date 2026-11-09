package io.github.eedaegon.liveactivity

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import io.github.eedaegon.liveupdate.LiveUpdateBridge
import io.github.eedaegon.liveupdate.LiveUpdateEvents
import org.json.JSONException
import org.json.JSONObject
import java.io.File

/** The argument of `registerEvents`: the channel that tells Rust that liveupdate stored an event. */
@InvokeArg
class EventRegistration {
    lateinit var channel: Channel
}

/**
 * The Android side of the plugin: notification permissions, and liveupdate's Android adapter, which the plugin's
 * Rust drives for templates and layouts alike. liveupdate's receivers store taps and dismissals; this plugin only
 * tells Rust to drain them.
 */
@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")])
class LiveActivityPlugin(private val activity: Activity) : Plugin(activity) {
    private val notifications = AndroidNotifications(activity)
    private val preferences = activity.getSharedPreferences(PLUGIN_PREFERENCES, Context.MODE_PRIVATE)

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

    /** One command of liveupdate's driver, answered by liveupdate's own Android adapter. */
    @Command
    fun liveUpdate(invoke: Invoke) = respond(invoke) {
        val args = invoke.getArgs()
        Input.keys(args, setOf("command", "payload"))
        LiveUpdateBridge.invoke(activity, args.getString("command"), args.getString("payload"))
    }

    /** Where Rust writes the PNGs of `writeImage`: the app's private files, where liveupdate reads large icons. */
    @Command
    fun imageDirectory(invoke: Invoke) = respond(invoke) {
        Input.keys(invoke.getArgs(), emptySet())
        JSONObject().put("path", File(activity.applicationContext.filesDir, IMAGE_FOLDER).absolutePath)
    }

    /**
     * Takes the channel that tells Rust to drain liveupdate's events. Rust sends it once, from plugin setup; the
     * channel then hears an empty message each time a receiver stored a tap or a dismissal.
     */
    @Command
    fun registerEvents(invoke: Invoke) = respond(invoke) {
        Input.keys(invoke.getArgs(), setOf("channel"))
        val channel = try { invoke.parseArgs(EventRegistration::class.java).channel } catch (_: Exception) {
            throw ActivityFailure("INVALID_INPUT", "Invalid event channel.")
        }
        registerEventSink { channel.send(JSObject()) }
        JSONObject()
    }

    internal fun registerEventSink(sink: () -> Unit) = LiveUpdateEvents.setListener { sink() }

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

    private companion object {
        /** Under the app's files: the pictures of `writeImage`, which liveupdate takes as app files. */
        const val IMAGE_FOLDER = "tauri-live-activity/images"
    }
}
