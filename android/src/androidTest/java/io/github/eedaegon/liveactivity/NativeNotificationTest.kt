package io.github.eedaegon.liveactivity

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.os.Build
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NativeNotificationTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val manager = context.getSystemService(NotificationManager::class.java)
    private val adapter = LiveUpdateAdapter(context)

    @Before
    fun prepare() {
        if (Build.VERSION.SDK_INT >= 33) {
            // Reading the output to its end waits for the grant; closing at once can let a post race it.
            instrumentation.uiAutomation.executeShellCommand(
                "pm grant ${context.packageName} ${Manifest.permission.POST_NOTIFICATIONS}",
            ).use { descriptor -> java.io.FileInputStream(descriptor.fileDescriptor).use { it.readBytes() } }
        }
        adapter.cancel(PROGRESS_ID)
        adapter.cancel(TIMER_ID)
    }

    @After
    fun cleanup() {
        adapter.cancel(PROGRESS_ID)
        adapter.cancel(TIMER_ID)
    }

    @Test
    fun adapterProjectsRustRecordsOntoFrameworkNotifications() {
        val progress = record(PROGRESS_ID, progressSnapshot())
        adapter.post(progress)
        val posted = notification(PROGRESS_ID)

        assertEquals("Dinner delivery", posted.extras.getString(Notification.EXTRA_TITLE))
        assertEquals("Your rider is on the way", posted.extras.getString(Notification.EXTRA_TEXT))
        assertEquals(400, posted.extras.getInt(Notification.EXTRA_PROGRESS))
        assertEquals(Notification.VISIBILITY_PRIVATE, posted.visibility)
        assertTrue(posted.flags and Notification.FLAG_ONGOING_EVENT != 0)
        assertTrue(posted.flags and Notification.FLAG_ONLY_ALERT_ONCE != 0)
        assertFalse(posted.extras.getString(RECORD_EXTRA).isNullOrBlank())

        val observation = adapter.observe().getJSONObject(0)
        assertEquals(PROGRESS_ID, observation.getString("id"))
        assertEquals("active", observation.getString("state"))
        assertEquals("notApplicable", observation.getString("promotionState"))
    }

    @Test
    fun timerProjectionUsesTheSystemChronometer() {
        val now = System.currentTimeMillis()
        val timer = JSONObject()
            .put("revision", 0)
            .put("title", "Break")
            .put("status", "Back soon")
            .put("timer", JSONObject().put("startedAt", now).put("endsAt", now + 300_000))
        adapter.post(record(TIMER_ID, timer, template = "timer"))

        val posted = notification(TIMER_ID)
        assertTrue(posted.extras.getBoolean(Notification.EXTRA_SHOW_CHRONOMETER))
        assertTrue(posted.extras.getBoolean(Notification.EXTRA_CHRONOMETER_COUNT_DOWN))
        assertEquals(now + 300_000, posted.`when`)
    }

    private fun notification(id: String): Notification {
        repeat(40) {
            manager.activeNotifications.firstOrNull { it.tag == TAG_PREFIX + id }?.let {
                return it.notification
            }
            Thread.sleep(50)
        }
        throw AssertionError("Notification $id was not posted")
    }

    private fun progressSnapshot(): JSONObject = JSONObject()
        .put("revision", 0)
        .put("title", "Dinner delivery")
        .put("status", "Your rider is on the way")
        .put("progress", 0.4)

    private fun record(id: String, snapshot: JSONObject, template: String = "progress"): JSONObject {
        val origin = JSONObject()
            .put("activityKey", "instrumentation:$id")
            .put("schemaVersion", 1)
            .put("template", template)
            .put("fallback", "notification")
            .put("visibility", "private")
            .put("snapshot", snapshot)
        return JSONObject()
            .put("id", id)
            .put("origin", origin)
            .put("snapshot", snapshot)
            .put("state", "unknown")
            .put("promotionRequested", false)
            .put("promotionState", "notApplicable")
            .put("awaitingObservation", true)
            .put("postFailed", false)
    }

    private companion object {
        const val PROGRESS_ID = "plugin-progress"
        const val TIMER_ID = "plugin-timer"
    }
}
