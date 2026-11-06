package io.github.eedaegon.liveactivity

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import app.tauri.plugin.Invoke
import com.fasterxml.jackson.databind.ObjectMapper
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Layout activities (contract v2) as real notifications, actions and dismissals. */
@RunWith(AndroidJUnit4::class)
class NativeLayoutTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private val store = LayoutPreferencesStore(context)
    private val port = LayoutNotifications(context)
    private val engine = LayoutEngine(store, port)
    private val request = """{"activityKey":"emulator:session","schemaVersion":2,"fallback":"notification",
        "layout":{"lockScreen":{"type":"vstack","children":[{"type":"text","bind":"title"},{"type":"text","bind":"status"},
        {"type":"progress","bind":"done"},{"type":"symbol","name":"mic"},
        {"type":"button","actionId":"stop","child":{"type":"text","value":"Stop"}},
        {"type":"button","actionId":"pause","child":{"type":"text","value":"Pause"}}]}},
        "snapshot":{"revision":0,"values":{"title":"Listening","status":"Hello from the lock screen","done":0.4}},"android":{"visibility":"public"}}"""

    @Before fun prepare() {
        if (Build.VERSION.SDK_INT >= 33) shell("pm grant ${context.packageName} ${Manifest.permission.POST_NOTIFICATIONS}")
        clear()
        store.write(emptyList())
    }

    @After fun cleanup() {
        engine.list().filter { !it.terminal }.forEach { engine.end(it.id, "immediate") }
        clear()
    }

    @Test fun theLockScreenTreeBecomesAPromotableNotification() {
        val record = engine.start(LayoutInput.start(JSONObject(request)))
        await { engine.list().any { it.id == record.id && it.state == "active" } }
        val native = posted(record.id)
        assertEquals("Listening", native.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertEquals("Hello from the lock screen", native.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        assertEquals("Hello from the lock screen", native.extras.getCharSequence(Notification.EXTRA_BIG_TEXT).toString())
        assertEquals(400, native.extras.getInt(Notification.EXTRA_PROGRESS))
        assertEquals(Notification.VISIBILITY_PUBLIC, native.visibility)
        assertTrue(native.flags and Notification.FLAG_ONGOING_EVENT != 0)
        assertEquals(listOf("Stop", "Pause"), native.actions.map { it.title.toString() })
        if (Build.VERSION.SDK_INT >= 31) {
            assertTrue(native.actions.all { it.actionIntent.isImmutable && !it.isAuthenticationRequired })
            assertTrue(native.deleteIntent.isImmutable)
        }
        if (Build.VERSION.SDK_INT >= 36) assertEquals("40%", native.shortCriticalText)
        // Promotion requested or not, nothing in the notification keeps it from being promoted.
        val promotable = port.build(record.copy(promotionRequested = true))
        assertFalse("Live Updates must not be colorized", promotable.extras.getBoolean(Notification.EXTRA_COLORIZED))
        if (Build.VERSION.SDK_INT >= 36 && Build.VERSION.SDK_INT_FULL >= Build.VERSION_CODES_FULL.BAKLAVA_1) {
            assertTrue(promotable.hasPromotableCharacteristics())
        } else if (Build.VERSION.SDK_INT >= 36) {
            // API 36.0 checks the earlier rules, which want EXTRA_COLORIZED; the published rules of
            // 36.1 forbid it. With only that extra added, 36.0's own check passes too.
            assertFalse(promotable.hasPromotableCharacteristics())
            val colorized = promotable.clone().apply { extras.putBoolean(Notification.EXTRA_COLORIZED, true) }
            assertTrue(colorized.hasPromotableCharacteristics())
        }
        assertFalse(native.extras.containsKey("android.ongoingActivityNoti.style"))
        val listed = engine.list().single { it.id == record.id }.json()
        assertEquals(2, listed.getInt("schemaVersion"))
        assertFalse(listed.has("template"))
        assertTrue(listed.getJSONArray("degradedFeatures").toString().contains("layout.symbol"))
    }

    @Test fun aTimerUsesTheChronometerAndSamsungExtrasNeedTheOption() {
        val now = System.currentTimeMillis()
        val timer = LayoutInput.start(JSONObject("""{"activityKey":"emulator:timer","schemaVersion":2,"fallback":"notification",
            "layout":{"lockScreen":{"type":"vstack","children":[{"type":"text","value":"Break"},{"type":"timerText","start":"from","end":"to"}]}},
            "snapshot":{"revision":0,"values":{"from":$now,"to":${now + 300000}}}}"""))
        val record = LayoutRecord("timer", timer, timer.snapshot)
        val plain = port.build(record)
        assertTrue(plain.extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER))
        assertTrue(plain.extras.getBoolean(Notification.EXTRA_CHRONOMETER_COUNT_DOWN))
        assertEquals(now + 300000, plain.`when`)
        assertEquals(Notification.VISIBILITY_PRIVATE, plain.visibility)
        val samsung = LayoutNotifications(context, { true }).build(record)
        assertEquals(Build.VERSION.SDK_INT >= SamsungNowBar.MIN_SDK, samsung.extras.getInt("android.ongoingActivityNoti.style") == 1)
        if (Build.VERSION.SDK_INT >= SamsungNowBar.MIN_SDK) {
            assertEquals("Break", samsung.extras.getString("android.ongoingActivityNoti.nowbarPrimaryInfo"))
            assertFalse(samsung.extras.containsKey("android.ongoingActivityNoti.nowbarSecondaryInfo"))
        }
    }

    @Test fun anActionReachesTheChannelWithTheActivityKey() {
        val taps = LinkedBlockingQueue<ActionTap>()
        ActionHub.register { taps.put(it) }
        val record = engine.start(LayoutInput.start(JSONObject(request)))
        await { manager.activeNotifications.any { it.tag == LAYOUT_TAG_PREFIX + record.id } }
        posted(record.id).actions[1].actionIntent.send()
        assertEquals(ActionTap("pause", record.id, "emulator:session"), taps.poll(10, TimeUnit.SECONDS))
        // A stray intent naming a button the activity does not have is dropped, and so is another
        // action. They go through the system, so the receiver gets a PendingResult as a tap does.
        broadcast(ACTION_TAPPED, record.id, "other")
        broadcast("unrelated", record.id, "stop")
        broadcast(ACTION_TAPPED, record.id, "stop")
        assertEquals(ActionTap("stop", record.id, "emulator:session"), taps.poll(10, TimeUnit.SECONDS))
        assertEquals(null, taps.poll(1, TimeUnit.SECONDS))
    }

    /** An explicit broadcast of this app, which reaches the receiver although it is not exported. */
    private fun broadcast(action: String, id: String, actionId: String) = context.sendBroadcast(
        Intent(context, ActionReceiver::class.java).setAction(action).putExtra("id", id).putExtra("actionId", actionId),
    )

    @Test fun aDismissedLayoutIsATombstoneAndV1NeverSeesIt() {
        val record = engine.start(LayoutInput.start(JSONObject(request)))
        await { engine.list().any { it.id == record.id && it.state == "active" } }
        posted(record.id).deleteIntent.send()
        await { store.read().any { it.id == record.id && it.state == "dismissed" } }
        try { engine.update(record.id, record.snapshot.copy(revision = 1)); fail("A dismissed layout must not be reposted") }
        catch (failure: ActivityFailure) { assertEquals("NOT_FOUND", failure.code) }
        assertTrue(ActivityEngine(PreferencesStore(context), AndroidNotifications(context)).list().none { it.id == record.id })
    }

    @Test fun theBridgeAnswersTheLayoutCommands() {
        val activity = instrumentation.startActivitySync(Intent(context, TestHostActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        try {
            val plugin = LiveActivityPlugin(activity)
            val capabilities = call(plugin, "getCapabilities").getJSONObject("data")
            assertEquals("supported" to "supported", capabilities.getString("layout") to capabilities.getString("actions"))
            val started = call(plugin, "startLayout", request)
            assertTrue(started.toString(), started.getBoolean("ok"))
            val id = started.getJSONObject("data").getString("id")
            val update = """{"id":"$id","snapshot":{"revision":1,"values":{"title":"Paused","status":"Tap to resume","done":0.5}}}"""
            assertTrue(call(plugin, "updateLayout", update).getBoolean("ok"))
            assertEquals("INVALID_INPUT", call(plugin, "updateLayout", update.replace("\"done\":0.5", "\"done\":\"half\"")).getJSONObject("error").getString("code"))
            assertEquals(1, call(plugin, "listLayout").getJSONArray("data").length())
            assertEquals("NOT_FOUND", call(plugin, "end", """{"id":"$id","policy":{"kind":"immediate"}}""").getJSONObject("error").getString("code"))
            assertTrue(call(plugin, "endLayout", """{"id":"$id","policy":{"kind":"immediate"}}""").getBoolean("ok"))
            assertEquals("INVALID_INPUT", call(plugin, "startLayout", "{}").getJSONObject("error").getString("code"))
            assertEquals("INVALID_INPUT", call(plugin, "registerActions", """{"channel":"nope","extra":1}""").getJSONObject("error").getString("code"))
        } finally { instrumentation.runOnMainSync { activity.finish() } }
    }

    private fun call(plugin: LiveActivityPlugin, command: String, args: String = "{}"): JSONObject {
        var response: String? = null
        val invoke = Invoke(1, command, 1, 2, { _, json -> response = json }, args, ObjectMapper())
        when (command) {
            "getCapabilities" -> plugin.getCapabilities(invoke)
            "startLayout" -> plugin.startLayout(invoke)
            "updateLayout" -> plugin.updateLayout(invoke)
            "endLayout" -> plugin.endLayout(invoke)
            "listLayout" -> plugin.listLayout(invoke)
            "end" -> plugin.end(invoke)
            "registerActions" -> plugin.registerActions(invoke)
        }
        return JSONObject(requireNotNull(response))
    }

    private fun posted(id: String): Notification = manager.activeNotifications.first { it.tag == LAYOUT_TAG_PREFIX + id }.notification

    private fun clear() {
        manager.activeNotifications.filter { it.tag?.startsWith(LAYOUT_TAG_PREFIX) == true }.forEach { manager.cancel(it.tag, it.id) }
    }

    private fun await(condition: () -> Boolean) {
        repeat(150) { if (condition()) return; Thread.sleep(100) }
        assertTrue("Native notification state did not converge", condition())
    }

    private fun shell(command: String) {
        instrumentation.uiAutomation.executeShellCommand(command).use { descriptor ->
            java.io.FileInputStream(descriptor.fileDescriptor).use { it.readBytes() }
        }
    }
}
