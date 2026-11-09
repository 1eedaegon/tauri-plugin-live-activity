package io.github.eedaegon.liveactivity

import android.Manifest
import android.app.Activity
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.tauri.plugin.Invoke
import com.fasterxml.jackson.databind.ObjectMapper
import io.github.eedaegon.liveupdate.LiveUpdateEvents
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

    // TP-ANDROID-10
    @Test
    fun aStoredTapWakesTheEventSinkAndDrainsThroughTheBridge() {
        val heard = AtomicInteger()
        plugin.registerEventSink { heard.incrementAndGet() }
        try {
            liveUpdate("events")
            liveUpdate("post", JSONObject().put("record", layoutRecord()))
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            var notification: android.app.Notification? = null
            repeat(40) {
                notification = notification ?: manager.activeNotifications
                    .firstOrNull { it.tag == "liveupdate-rs:$ACTIVITY_ID" }?.notification
                if (notification == null) Thread.sleep(50)
            }
            requireNotNull(notification).actions[0].actionIntent.send()
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

    private fun callLiveUpdate(args: JSONObject): JSONObject {
        var response: String? = null
        val invoke = Invoke(1, "liveUpdate", 1, 2, { _, json -> response = json }, args.toString(), ObjectMapper())
        plugin.liveUpdate(invoke)
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
        val snapshot = JSONObject()
            .put("revision", 0)
            .put("title", "Mochi wants attention")
            .put("status", "No pets yet")
            .put("presentation", JSONObject()
                .put("style", JSONObject().put("kind", "standard"))
                .put("actions", JSONArray().put(action)))
        val origin = JSONObject()
            .put("activityKey", "mochi:instrumentation")
            .put("schemaVersion", 2)
            .put("template", "standard")
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
