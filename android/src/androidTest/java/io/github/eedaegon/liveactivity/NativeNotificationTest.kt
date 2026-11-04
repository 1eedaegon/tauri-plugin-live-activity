package io.github.eedaegon.liveactivity

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.Assume.assumeTrue
import java.util.UUID

@RunWith(AndroidJUnit4::class)
class NativeNotificationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    private val port = AndroidNotifications(context)
    private val store = PreferencesStore(context)
    private val engine = ActivityEngine(store, port)
    private val request = StartRequest("emulator:delivery", 1, "progress", "notification", Snapshot(0, "Dinner delivery", "Your rider is on the way", 0.4, null, null))

    @Before fun prepare() {
        if (Build.VERSION.SDK_INT >= 33) shell("pm grant ${context.packageName} ${Manifest.permission.POST_NOTIFICATIONS}")
        manager.activeNotifications.filter { it.tag?.startsWith(TAG_PREFIX) == true }.forEach { manager.cancel(it.tag, it.id) }
        store.write(emptyList())
    }

    @After fun cleanup() {
        engine.list().filter { !it.terminal }.forEach { engine.end(it.id, "immediate") }
        manager.cancel("unrelated", 77)
    }

    @Test fun nativeProgressUpdateRestartAndRemovalPreserveOtherNotifications() {
        val record = engine.start(request)
        val initial = awaitRecord(record.id)
        assertEquals("active", initial.state)
        val unrelated = Notification.Builder(context, CHANNEL_ID).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Unrelated notification").build()
        manager.notify("unrelated", 77, unrelated)
        engine.update(record.id, request.snapshot.copy(revision = 1, progress = 0.8, status = "Arriving soon"))
        val updated = awaitRecord(record.id, 1)
        assertEquals(0.8, updated.snapshot.progress!!, 0.0)
        assertEquals(record.id, ActivityEngine(PreferencesStore(context), AndroidNotifications(context)).list().first { it.id == record.id }.id)
        val native = manager.activeNotifications.first { it.tag == TAG_PREFIX + record.id }
        assertEquals(800, native.notification.extras.getInt(Notification.EXTRA_PROGRESS))
        assertTrue(native.notification.flags and Notification.FLAG_ONLY_ALERT_ONCE != 0)
        assertTrue(native.notification.flags and Notification.FLAG_ONGOING_EVENT != 0)
        if (Build.VERSION.SDK_INT >= 36) {
            assertEquals(native.notification.flags and Notification.FLAG_PROMOTED_ONGOING != 0, updated.promotionState == "promoted")
        }
        engine.end(record.id, "immediate")
        await { manager.activeNotifications.none { it.tag == TAG_PREFIX + record.id } }
        assertTrue(manager.activeNotifications.any { it.tag == "unrelated" })
    }

    @Test fun nativeDismissalCannotBeResurrectedAndTimerUsesChronometer() {
        val now = System.currentTimeMillis()
        val timer = request.copy(activityKey = "emulator:timer", template = "timer", snapshot = request.snapshot.copy(progress = null, timer = Timer(now, now + 300000)))
        val record = engine.start(timer)
        awaitRecord(record.id)
        val native = manager.activeNotifications.first { it.tag == TAG_PREFIX + record.id }
        assertTrue(native.notification.extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER))
        assertTrue(native.notification.extras.getBoolean(Notification.EXTRA_CHRONOMETER_COUNT_DOWN))
        manager.cancel(TAG_PREFIX + record.id, native.id)
        await { manager.activeNotifications.none { it.tag == TAG_PREFIX + record.id } }
        assertEquals("dismissed", engine.list().first { it.id == record.id }.state)
        try { engine.update(record.id, timer.snapshot.copy(revision = 1)); fail("Dismissed activity must not be reposted") }
        catch (failure: ActivityFailure) { assertEquals("NOT_FOUND", failure.code) }
    }

    @Test fun minimumImportanceCannotSatisfyStrictPromotionAndBlockedChannelRejectsStart() {
        assumeTrue(Build.VERSION.SDK_INT >= 26)
        val channelId = "live-activity-test-${UUID.randomUUID()}"
        val channelPort = AndroidNotifications(context, channelId)
        try {
            manager.createNotificationChannel(NotificationChannel(channelId, "Test channel", NotificationManager.IMPORTANCE_MIN))
            assertTrue(channelPort.notificationsAllowed())
            assertFalse("Android excludes IMPORTANCE_MIN from Live Updates", channelPort.promotionAllowed())
            try { ActivityEngine(store, channelPort).start(request.copy(fallback = "none")); fail("Strict promotion must fail") }
            catch (failure: ActivityFailure) { assertEquals("UNSUPPORTED_FEATURE", failure.code) }
            manager.createNotificationChannel(NotificationChannel(channelId, "Test channel", NotificationManager.IMPORTANCE_NONE))
            assertFalse(channelPort.notificationsAllowed())
            try { ActivityEngine(store, channelPort).start(request); fail("Blocked channel must reject posting") }
            catch (failure: ActivityFailure) { assertEquals("PERMISSION_DENIED", failure.code) }
        } finally { manager.deleteNotificationChannel(channelId) }
    }

    @Test fun staleDeadlineUsesObservedStateAndAnUpdateCanRefreshIt() {
        val staleRequest = request.copy(snapshot = request.snapshot.copy(staleAt = System.currentTimeMillis() - 1))
        val record = engine.start(staleRequest)
        await { engine.list().any { it.id == record.id && it.state == "stale" } }
        engine.update(record.id, request.snapshot.copy(revision = 1, staleAt = System.currentTimeMillis() + 60000))
        assertEquals("active", awaitRecord(record.id, 1).state)
    }

    @Test fun nativeDeleteIntentPersistsDismissalAndBlocksFutureUpdates() {
        val record = engine.start(request)
        awaitRecord(record.id)
        val native = manager.activeNotifications.first { it.tag == TAG_PREFIX + record.id }
        assertTrue(native.notification.deleteIntent.isImmutable)
        native.notification.deleteIntent.send()
        await { store.read().any { it.id == record.id && it.state == "dismissed" } }
        try { engine.update(record.id, request.snapshot.copy(revision = 1)); fail("User dismissal must remain terminal") }
        catch (failure: ActivityFailure) { assertEquals("NOT_FOUND", failure.code) }
        await { manager.activeNotifications.none { it.tag == TAG_PREFIX + record.id } }
    }

    private fun awaitRecord(id: String, revision: Long = 0): ActivityRecord {
        await { engine.list().any { it.id == id && it.state == "active" && it.snapshot.revision == revision } }
        return engine.list().first { it.id == id }
    }

    private fun await(condition: () -> Boolean) {
        repeat(50) { if (condition()) return; Thread.sleep(100) }
        assertTrue("Native notification state did not converge", condition())
    }

    private fun shell(command: String) {
        instrumentation.uiAutomation.executeShellCommand(command).use { descriptor ->
            java.io.FileInputStream(descriptor.fileDescriptor).use { it.readBytes() }
        }
    }
}
