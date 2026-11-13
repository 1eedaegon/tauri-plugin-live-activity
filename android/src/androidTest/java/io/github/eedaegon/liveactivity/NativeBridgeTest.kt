package io.github.eedaegon.liveactivity

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.tauri.plugin.Invoke
import com.fasterxml.jackson.databind.ObjectMapper
import io.github.eedaegon.liveupdate.LiveUpdateEvents
import java.io.File
import java.util.concurrent.atomic.AtomicInteger
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

class TestHostActivity : Activity()

@RunWith(AndroidJUnit4::class)
class NativeBridgeTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private lateinit var activity: Activity
    private lateinit var plugin: LiveActivityPlugin

    @Before
    fun prepare() {
        if (Build.VERSION.SDK_INT >= 33) {
            shell("pm grant ${context.packageName} ${Manifest.permission.POST_NOTIFICATIONS}")
        }
        activity = instrumentation.startActivitySync(
            Intent(context, TestHostActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        plugin = LiveActivityPlugin(activity)
        liveUpdate("write", JSONObject().put("records", JSONArray()))
        liveUpdate("cancel", JSONObject().put("id", ACTIVITY_ID))
    }

    @After
    fun cleanup() {
        liveUpdate("cancel", JSONObject().put("id", ACTIVITY_ID))
        liveUpdate("write", JSONObject().put("records", JSONArray()))
        instrumentation.runOnMainSync { activity.finish() }
    }

    @Test
    fun pluginExposesOnlyTheBoundedAdapterProtocol() {
        val capabilities = liveUpdate("capabilities").getJSONObject("data")
        assertTrue(capabilities.getBoolean("notificationsEnabled"))
        assertEquals(Build.VERSION.SDK_INT >= 36, capabilities.getBoolean("supported"))

        val record = record()
        liveUpdate("write", JSONObject().put("records", JSONArray().put(record)))
        assertEquals(ACTIVITY_ID, liveUpdate("read").getJSONArray("data").getJSONObject(0).getString("id"))

        liveUpdate("post", JSONObject().put("record", record))
        val observation = awaitObservation(true).getJSONObject(0)
        assertEquals(ACTIVITY_ID, observation.getString("id"))
        assertEquals("active", observation.getString("state"))
        assertEquals("notApplicable", observation.getString("promotionState"))

        liveUpdate("cancel", JSONObject().put("id", ACTIVITY_ID))
        assertEquals(0, awaitObservation(false).length())
    }

    @Test
    fun pluginKeepsProtocolFailuresInsideTheInnerEnvelope() {
        val unknown = liveUpdateFailure("start", JSONObject())
        assertEquals("INVALID_INPUT", unknown.getJSONObject("error").getString("code"))

        val malformed = liveUpdateFailure("post", JSONObject().put("record", JSONObject()))
        assertEquals("INVALID_INPUT", malformed.getJSONObject("error").getString("code"))

        val outer = callLiveUpdate(JSONObject().put("command", "read"))
        assertFalse(outer.getBoolean("ok"))
        assertEquals("INVALID_INPUT", outer.getJSONObject("error").getString("code"))
    }

    // TP-ANDROID-13
    @Test
    fun permissionsFollowWhatLiveupdatesAdapterObserves() {
        val observed = liveUpdate("capabilities").getJSONObject("data")
        val reply = call("checkPermissions", JSONObject(), plugin::checkPermissions)
        assertTrue(reply.toString(), reply.getBoolean("ok"))
        val permissions = reply.getJSONObject("data")
        // `prepare` granted the runtime permission, and nothing blocked liveupdate's channel.
        assertTrue(observed.getBoolean("notificationsEnabled"))
        assertEquals("granted", permissions.getString("notifications"))
        val promotion = permissions.getString("promotion")
        assertEquals(Build.VERSION.SDK_INT >= 36, promotion != "notApplicable")
        assertEquals(observed.getBoolean("promotionEnabled"), promotion == "granted")
        assertEquals("notApplicable", permissions.getString("liveActivities"))
        assertEquals("notApplicable", permissions.getString("frequentPushes"))
    }

    // TP-ANDROID-13
    @Test
    fun aRequestThatNeedsNoDialogAnswersThePermissions() {
        // With notifications allowed Android has nothing to ask, and the other kinds have no dialog at all.
        for (kind in listOf("notifications", "promotion", "liveActivities")) {
            val reply = call("requestPermissions", JSONObject().put("kind", kind), plugin::requestPermissions)
            assertTrue(reply.toString(), reply.getBoolean("ok"))
            assertEquals("granted", reply.getJSONObject("data").getString("notifications"))
        }
        val unknown = call("requestPermissions", JSONObject().put("kind", "camera"), plugin::requestPermissions)
        assertFalse(unknown.toString(), unknown.getBoolean("ok"))
        assertEquals("INVALID_INPUT", unknown.getJSONObject("error").getString("code"))
    }

    // TP-ANDROID-10
    @Test
    fun aStoredTapWakesTheEventSinkAndDrainsThroughTheBridge() {
        val heard = AtomicInteger()
        plugin.registerEventSink { heard.incrementAndGet() }
        try {
            liveUpdate("events")
            liveUpdate("post", JSONObject().put("record", layoutRecord()))
            posted().actions[0].actionIntent.send()
            repeat(100) { if (heard.get() == 0) Thread.sleep(50) }
            assertEquals(1, heard.get())

            val events = liveUpdate("events").getJSONObject("data").getJSONArray("events")
            assertEquals(1, events.length())
            assertEquals(ACTIVITY_ID, events.getJSONObject(0).getString("activityId"))
            assertEquals("pet", events.getJSONObject(0).getJSONObject("kind").getString("actionId"))
        } finally {
            LiveUpdateEvents.setListener(null)
        }
    }

    /**
     * The contents of tests/fixtures/android/contents.json, which the Rust models write as they stand there
     * (tests/android_contents.rs), each in the record of a first snapshot. What Android then holds is read back: that it
     * draws it is Android's.
     */
    // TP-ANDROID-14
    @Test
    fun liveupdatesAdapterPostsEveryAndroidContentThatRustWrites() {
        val fixture = instrumentation.context.assets.open("contents.json").bufferedReader().use { it.readText() }
        val cases = JSONArray(fixture)
        // How the guide tells an app that it runs on Android 16, where the fixture has answers of its own.
        val styles = liveUpdate("capabilities").getJSONObject("data").getJSONObject("presentation")
        assertEquals(Build.VERSION.SDK_INT >= 36, styles.getBoolean("progressStyle"))
        assertEquals(Build.VERSION.SDK_INT >= 37, styles.getBoolean("metricStyle"))
        val badge = writeBadge()
        try {
            for (index in 0 until cases.length()) {
                val case = cases.getJSONObject(index)
                inCase(case.getString("name")) {
                    val content = startingNow(case.getJSONObject("content"))
                    val (answer, detail) = answerTo(contentRecord(content))
                    assertEquals(detail, expected(case), answer)
                    if (answer == "ok") {
                        assertShows(content, posted())
                        liveUpdate("cancel", JSONObject().put("id", ACTIVITY_ID))
                        awaitObservation(false)
                    }
                }
            }
        } finally {
            badge.delete()
        }
    }

    /** Runs [check] for the case [name], which leads the message of a failure. */
    private fun inCase(name: String, check: () -> Unit) {
        try { check() } catch (failure: AssertionError) { throw AssertionError("$name: ${failure.message}", failure) }
    }

    /** What the fixture says of [case] on this device: Android 16 has an answer of its own where it differs. */
    private fun expected(case: JSONObject): String =
        if (Build.VERSION.SDK_INT == 36 && case.has("android16")) case.getString("android16") else case.getString("android")

    /**
     * [content] with the timer of its style moved to begin now. The times of the fixture are of the day it was
     * written, and Android 16 ignores a notification whose time is more than two weeks past without telling the app.
     */
    private fun startingNow(content: JSONObject): JSONObject {
        val moved = JSONObject(content.toString())
        val style = moved.getJSONObject("presentation").getJSONObject("style")
        val timer = style.optJSONObject("value")?.optJSONObject("timer") ?: return moved
        val shift = System.currentTimeMillis() - timer.getLong("startedAt")
        timer.put("startedAt", timer.getLong("startedAt") + shift).put("endsAt", timer.getLong("endsAt") + shift)
        return moved
    }

    /**
     * What liveupdate's Android side answers to a post of [record], `ok` or the code of its refusal, and the answer
     * in full. The one method that liveupdate 0.1 calls and Android 16 lacks is `NATIVE_ERROR`: Tauri, which calls the
     * command, rejects it when it throws, and the Rust side knows no more of a rejected command. Another missing
     * method would be a difference that the fixture does not name.
     */
    private fun answerTo(record: JSONObject): Pair<String, String> = try {
        val answer = innerResponse("post", JSONObject().put("record", record))
        val code = if (answer.getString("status") == "ok") "ok" else answer.getJSONObject("error").getString("code")
        code to answer.toString()
    } catch (error: NoSuchMethodError) {
        assertTrue(error.toString(), error.message.orEmpty().contains("setSemanticStyle"))
        "NATIVE_ERROR" to error.toString()
    }

    /** What Android holds of [content] once liveupdate's adapter has posted it. */
    private fun assertShows(content: JSONObject, notification: Notification) {
        val extras = notification.extras
        assertEquals(content.getString("title"), extras.getCharSequence(Notification.EXTRA_TITLE)?.toString())
        assertEquals(content.getString("status"), extras.getCharSequence(Notification.EXTRA_TEXT)?.toString())
        val presentation = content.getJSONObject("presentation")
        val style = presentation.getJSONObject("style")
        val value = style.optJSONObject("value") ?: JSONObject()
        // A standard notification has no more to show, and metrics are drawn from Android 17 on.
        when (style.getString("kind")) {
            "bigText" -> {
                assertEquals(value.getString("text"), extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString())
                assertEquals(value.textOrNull("summary"), extras.getCharSequence(Notification.EXTRA_SUMMARY_TEXT)?.toString())
            }
            "progress" -> assertEquals(value.getInt("progress"), extras.getInt(Notification.EXTRA_PROGRESS, -1))
            "timer" -> {
                val countsDown = value.getBoolean("countsDown")
                val shown = value.getJSONObject("timer").getLong(if (countsDown) "endsAt" else "startedAt")
                assertTrue(extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER))
                assertEquals(countsDown, extras.getBoolean(Notification.EXTRA_CHRONOMETER_COUNT_DOWN))
                assertEquals(shown, notification.`when`)
            }
        }
        val actions = presentation.optJSONArray("actions") ?: JSONArray()
        val titles = (0 until actions.length()).map { actions.getJSONObject(it).getString("title") }
        assertEquals(titles, notification.actions.orEmpty().map { it.title.toString() })
        assertEquals(presentation.has("largeIcon"), notification.getLargeIcon() != null)
        if (Build.VERSION.SDK_INT >= 36) {
            assertEquals(presentation.textOrNull("shortCriticalText"), notification.shortCriticalText)
        }
    }

    private fun JSONObject.textOrNull(name: String): String? = if (has(name)) getString(name) else null

    /**
     * The image that the `appFile` icons of the fixture name, in the folder where `writeImage` puts one
     * (tests/android-contents.test.mjs compares the three).
     */
    private fun writeBadge(): File {
        val badge = File(context.filesDir, "tauri-live-activity/images/badge.png")
        requireNotNull(badge.parentFile).mkdirs()
        badge.outputStream().use { Bitmap.createBitmap(8, 8, Bitmap.Config.ARGB_8888).compress(Bitmap.CompressFormat.PNG, 100, it) }
        return badge
    }

    /** The activity's notification as Android holds it, once it shows. */
    private fun posted(): Notification {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        repeat(40) {
            manager.activeNotifications.firstOrNull { it.tag == "liveupdate-rs:$ACTIVITY_ID" }?.let { return it.notification }
            Thread.sleep(50)
        }
        throw AssertionError("The notification did not show")
    }

    private fun awaitObservation(present: Boolean): JSONArray {
        repeat(40) {
            val observations = liveUpdate("observe").getJSONArray("data")
            if ((observations.length() > 0) == present) return observations
            Thread.sleep(50)
        }
        throw AssertionError("Notification observation did not become $present")
    }

    private fun liveUpdate(command: String, payload: JSONObject = JSONObject()): JSONObject {
        val response = innerResponse(command, payload)
        assertEquals(response.toString(), "ok", response.getString("status"))
        return response
    }

    private fun liveUpdateFailure(command: String, payload: JSONObject): JSONObject {
        val response = innerResponse(command, payload)
        assertEquals(response.toString(), "error", response.getString("status"))
        return response
    }

    private fun innerResponse(command: String, payload: JSONObject): JSONObject {
        val args = JSONObject().put("command", command).put("payload", payload.toString())
        val outer = callLiveUpdate(args)
        assertTrue(outer.toString(), outer.getBoolean("ok"))
        return JSONObject(outer.getString("data"))
    }

    private fun callLiveUpdate(args: JSONObject): JSONObject = call("liveUpdate", args, plugin::liveUpdate)

    /** The envelope that a command of the plugin answers to [args]. */
    private fun call(command: String, args: JSONObject, run: (Invoke) -> Unit): JSONObject {
        var response: String? = null
        run(Invoke(1, command, 1, 2, { _, json -> response = json }, args.toString(), ObjectMapper()))
        return JSONObject(requireNotNull(response))
    }

    private fun record(): JSONObject {
        val snapshot = JSONObject()
            .put("revision", 0)
            .put("title", "Mochi's snack delivery")
            .put("status", "Preparing")
            .put("progress", 0.25)
        val origin = JSONObject()
            .put("activityKey", "delivery:instrumentation")
            .put("schemaVersion", 1)
            .put("template", "progress")
            .put("fallback", "notification")
            .put("visibility", "private")
            .put("snapshot", snapshot)
        return JSONObject()
            .put("id", ACTIVITY_ID)
            .put("origin", origin)
            .put("snapshot", snapshot)
            .put("state", "unknown")
            .put("promotionRequested", false)
            .put("promotionState", "notApplicable")
            .put("awaitingObservation", true)
            .put("postFailed", false)
    }

    /** A schema-v2 record with one action, as the plugin's Rust posts a layout. */
    private fun layoutRecord(): JSONObject {
        val action = JSONObject().put("id", "pet").put("title", "Pet Mochi").put("authenticationRequired", false)
        return contentRecord(JSONObject()
            .put("title", "Mochi wants attention")
            .put("status", "No pets yet")
            .put("presentation", JSONObject()
                .put("style", JSONObject().put("kind", "standard"))
                .put("actions", JSONArray().put(action))))
    }

    /**
     * The schema-v2 record of a first snapshot that shows [content]: the snapshot is the content with a revision, and
     * the template is the kind of its style.
     */
    private fun contentRecord(content: JSONObject): JSONObject {
        val snapshot = JSONObject(content.toString()).put("revision", 0)
        val origin = JSONObject()
            .put("activityKey", "mochi:instrumentation")
            .put("schemaVersion", 2)
            .put("template", content.getJSONObject("presentation").getJSONObject("style").getString("kind"))
            .put("fallback", "notification")
            .put("visibility", "private")
            .put("snapshot", snapshot)
        return JSONObject()
            .put("id", ACTIVITY_ID)
            .put("origin", origin)
            .put("snapshot", snapshot)
            .put("state", "unknown")
            .put("promotionRequested", false)
            .put("promotionState", "notApplicable")
            .put("awaitingObservation", true)
            .put("postFailed", false)
    }

    private fun shell(command: String) {
        instrumentation.uiAutomation.executeShellCommand(command).use { descriptor ->
            java.io.FileInputStream(descriptor.fileDescriptor).use { it.readBytes() }
        }
    }

    private companion object {
        const val ACTIVITY_ID = "plugin-instrumentation-activity"
    }
}
