package io.github.eedaegon.liveactivity

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.tauri.plugin.Invoke
import com.fasterxml.jackson.databind.ObjectMapper
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
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
    private val request = """{"activityKey":"bridge:download","schemaVersion":1,"template":"progress","fallback":"notification","snapshot":{"revision":0,"title":"Downloading files","status":"65 of 100 files","progress":0.65}}"""

    @Before fun prepare() {
        if (Build.VERSION.SDK_INT >= 33) shell("pm grant ${context.packageName} ${Manifest.permission.POST_NOTIFICATIONS}")
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().clear().commit()
        activity = instrumentation.startActivitySync(Intent(context, TestHostActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        plugin = LiveActivityPlugin(activity)
    }

    @After fun cleanup() {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
        manager.activeNotifications.filter { it.tag?.startsWith(TAG_PREFIX) == true }.forEach { manager.cancel(it.tag, it.id) }
        instrumentation.runOnMainSync { activity.finish() }
    }

    @Test fun bridgeReturnsStableEnvelopesAcrossACompleteLifecycle() {
        assertEquals("android", call("capabilities").getJSONObject("data").getString("platform"))
        assertEquals("granted", call("checkPermissions").getJSONObject("data").getString("notifications"))
        listOf("notifications", "promotion", "liveActivities").forEach {
            assertTrue(call("requestPermissions", """{"kind":"$it"}""").getBoolean("ok"))
        }
        val started = call("start", request)
        assertTrue(started.toString(), started.getBoolean("ok"))
        val id = started.getJSONObject("data").getString("id")
        val update = JSONObject().put("id", id).put("snapshot", JSONObject(request).getJSONObject("snapshot").put("revision", 1).put("progress", 0.9))
        assertTrue(call("update", update.toString()).getBoolean("ok"))
        val listed = call("list").getJSONArray("data")
        assertTrue(listed.length() > 0)
        assertTrue(call("end", JSONObject().put("id", id).put("policy", JSONObject().put("kind", "immediate")).toString()).getBoolean("ok"))
    }

    @Test fun bridgeRejectsInvalidInputsAndReportsCorruptStorage() {
        assertEquals("INVALID_INPUT", call("start", "{}").getJSONObject("error").getString("code"))
        assertEquals("INVALID_INPUT", call("start", JSONObject(request).put("snapshot", "invalid").toString()).getJSONObject("error").getString("code"))
        assertEquals("INVALID_INPUT", call("requestPermissions", """{"kind":"invalid"}""").getJSONObject("error").getString("code"))
        context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE).edit().putString("records", "broken-json").commit()
        assertEquals("NATIVE_ERROR", call("list").getJSONObject("error").getString("code"))
    }

    @Test fun explicitDismissReceiverOnlyTouchesTheMatchingRecord() {
        val original = Input.start(JSONObject(request))
        val store = PreferencesStore(context)
        store.write(listOf(ActivityRecord("one", original), ActivityRecord("two", original.copy(activityKey = "other"))))
        val receiver = DismissReceiver()
        receiver.onReceive(context, Intent("unrelated").putExtra("id", "one"))
        assertEquals("unknown", store.read().first().state)
        receiver.onReceive(context, Intent(DISMISS_ACTION))
        receiver.onReceive(context, Intent(DISMISS_ACTION).putExtra("id", "one"))
        assertEquals("dismissed", store.read().first().state)
        assertEquals("unknown", store.read()[1].state)
    }

    private fun call(command: String, args: String = "{}"): JSONObject {
        var response: String? = null
        val invoke = Invoke(1, command, 1, 2, { _, json -> response = json }, args, ObjectMapper())
        when (command) {
            "capabilities" -> plugin.getCapabilities(invoke)
            "checkPermissions" -> plugin.checkPermissions(invoke)
            "requestPermissions" -> plugin.requestPermissions(invoke)
            "start" -> plugin.start(invoke)
            "update" -> plugin.update(invoke)
            "end" -> plugin.end(invoke)
            "list" -> plugin.list(invoke)
        }
        return JSONObject(requireNotNull(response))
    }

    private fun shell(command: String) {
        instrumentation.uiAutomation.executeShellCommand(command).use { descriptor ->
            java.io.FileInputStream(descriptor.fileDescriptor).use { it.readBytes() }
        }
    }
}
