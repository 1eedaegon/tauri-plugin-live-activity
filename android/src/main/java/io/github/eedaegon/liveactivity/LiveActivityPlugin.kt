package io.github.eedaegon.liveactivity

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import app.tauri.Logger
import app.tauri.PermissionHelper
import app.tauri.annotation.ActivityCallback
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

/** The argument of `registerEvents`: the channel that tells Rust that liveupdate stored an event. */
@InvokeArg
class EventRegistration {
    lateinit var channel: Channel
}

/**
 * The intent that opens the setting where the person allows the app of [packageName] exact alarms. Android has it
 * from Android 12, which is as far back as [exactAlarmSetting] opens it.
 */
@SuppressLint("InlinedApi")
internal fun exactAlarmSettingsIntent(packageName: String): Intent =
    Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName"))

/**
 * The Android side of the plugin: notification permissions, the setting for exact alarms, and liveupdate's Android
 * adapter, which the plugin's Rust drives for templates and layouts alike. liveupdate's receivers store taps and
 * dismissals, and [OpeningIntents] has it store the openings of the app from a notification; this plugin tells Rust
 * to drain them.
 */
@TauriPlugin(permissions = [Permission(strings = [Manifest.permission.POST_NOTIFICATIONS], alias = "notifications")])
class LiveActivityPlugin(private val activity: Activity) : Plugin(activity) {
    private val preferences = activity.getSharedPreferences(PLUGIN_PREFERENCES, Context.MODE_PRIVATE)

    /** The calls that wait for the person to come back from the setting for exact alarms. */
    private val exactAlarmVisit = SettingVisit<Invoke>()

    /** The activity that Tauri last said is in front: after a recreation it is no longer the one of the constructor. */
    private var front: Activity = activity

    /** Opens a setting for a call. The device tests, which have no Tauri around the plugin, put their own here. */
    internal var settingOpener: (Invoke, Intent) -> Unit = { invoke, intent ->
        startActivityForResult(invoke, intent, "exactAlarmSettingsClosed")
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
            val settings = observed()
            val notifications = notificationPermission(settings)
            if (kind == "notifications" && dialogCanAsk(notifications)) {
                requestPermissionForAlias("notifications", invoke, "permissionResult")
            } else respond(invoke) { permissionsOf(settings, notifications) }
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

    /**
     * Opens the setting where the person allows the app exact alarms, which a scheduled start needs to begin at its
     * time, and answers when they are back; Rust then reads the capabilities again. Where there is nothing to allow
     * it answers at once. A call that comes while the setting is open waits with the first ([SettingVisit]),
     * wherever the app is by then.
     */
    @SuppressLint("InlinedApi")
    @Command
    fun openExactAlarmSettings(invoke: Invoke) {
        try {
            Input.keys(invoke.getArgs(), emptySet())
            if (exactAlarmVisit.joinIfOpen(invoke)) return
            val setting = exactAlarmSetting(
                sdk = Build.VERSION.SDK_INT,
                allowed = exactAlarmsAllowed(observed()),
                declared = PermissionHelper.hasDefinedPermission(activity, Manifest.permission.SCHEDULE_EXACT_ALARM),
                onScreen = onScreen(),
            )
            when (setting) {
                ExactAlarmSetting.NothingToAllow -> respond(invoke) { JSONObject() }
                ExactAlarmSetting.NotDeclared ->
                    throw ActivityFailure("CONFIGURATION_REQUIRED", "The app's manifest does not declare SCHEDULE_EXACT_ALARM.")
                ExactAlarmSetting.NotOnScreen ->
                    throw ActivityFailure("NOT_FOREGROUND", "Android opens the setting for exact alarms only for an app that is on screen.")
                ExactAlarmSetting.Open -> if (exactAlarmVisit.join(invoke)) openForVisit(invoke)
            }
        } catch (error: Exception) { failure(invoke, error) }
    }

    /**
     * Opens the setting for the visit that [invoke] began. A setting that does not open is the answer of every call
     * that waits for it by then, and the next call opens it again.
     */
    private fun openForVisit(invoke: Invoke) {
        try {
            settingOpener(invoke, exactAlarmSettingsIntent(activity.packageName))
        } catch (error: Exception) {
            val reason = when (error) {
                is ActivityNotFoundException -> ActivityFailure("UNSUPPORTED_FEATURE", "This device has no setting for exact alarms.")
                else -> error
            }
            for (waiting in exactAlarmVisit.end()) failure(waiting, reason)
        }
    }

    @ActivityCallback
    private fun exactAlarmSettingsClosed(invoke: Invoke, result: ActivityResult) = backFromExactAlarmSettings()

    /**
     * The app is in front again. An activity result that Tauri did not hand on, because another plugin opened a
     * screen meanwhile, leaves no call waiting for ever.
     */
    override fun onResume(activity: AppCompatActivity) {
        front = activity
        backFromExactAlarmSettings()
    }

    /**
     * Answers the calls that wait for the setting: the person is back, whatever they did there. Tauri guards a
     * command against what it throws, but not this call from the activity's life, so an answer that cannot be given
     * is logged and ends nothing.
     */
    internal fun backFromExactAlarmSettings() {
        for (invoke in exactAlarmVisit.end()) {
            try {
                respond(invoke) { JSONObject() }
            } catch (error: Exception) {
                Logger.error("A call that waited for the setting for exact alarms could not be answered.", error)
            }
        }
    }

    /** Whether the app's activity is on screen. One that cannot say is taken to be, and Android decides. */
    private fun onScreen(): Boolean =
        (front as? LifecycleOwner)?.lifecycle?.currentState?.isAtLeast(Lifecycle.State.STARTED) ?: true

    /** One command of liveupdate's driver, answered by liveupdate's own Android adapter. */
    @Command
    fun liveUpdate(invoke: Invoke) = respond(invoke) {
        val args = invoke.getArgs()
        Input.keys(args, setOf("command", "payload"))
        LiveUpdateBridge.invoke(activity, args.getString("command"), args.getString("payload"))
    }

    /**
     * The folder of the app's private files. Rust keeps the layouts under it and writes the PNGs of `writeImage`
     * there, where liveupdate reads large icons; the names of both are Rust's.
     */
    @Command
    fun filesDirectory(invoke: Invoke) = respond(invoke) {
        Input.keys(invoke.getArgs(), emptySet())
        JSONObject().put("path", activity.applicationContext.filesDir.absolutePath)
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

    private fun permissions(): JSONObject =
        observed().let { permissionsOf(it, notificationPermission(it)) }

    /**
     * What liveupdate's adapter observes of the notification settings, of its channel and of the permission for
     * exact alarms, as its `capabilities` answer them to Rust. The plugin reads them nowhere else, so its permissions
     * agree with what liveupdate may post, and its setting for exact alarms with the alarm that liveupdate sets.
     */
    private fun observed(): JSONObject =
        observedSettings(LiveUpdateBridge.invoke(activity, "capabilities", "{}"))

    // Tauri can cache DENIED for a cancelled dialog. Only an observed rationale proves
    // a previous denial; otherwise report uncertainty and allow an explicit retry.
    private fun notificationPermission(settings: JSONObject): String = notificationPermissionState(
        Build.VERSION.SDK_INT,
        settings.getBoolean("notificationsEnabled"),
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
