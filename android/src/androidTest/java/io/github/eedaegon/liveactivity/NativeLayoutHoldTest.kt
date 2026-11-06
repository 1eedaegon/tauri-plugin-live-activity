package io.github.eedaegon.liveactivity

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import android.util.Log
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * A check for a person at the phone, skipped unless `-e liveActivityHold <seconds>` is passed:
 * it posts a layout notification, updates its body every 5 s and logs every tap under the tag
 * `LiveActivityHold`. `-e samsungNowBar true` adds the One UI extras; `-e liveActivityKeep true`
 * leaves the notification posted when the run ends, so a tap can start a killed process.
 */
@RunWith(AndroidJUnit4::class)
class NativeLayoutHoldTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val context = instrumentation.targetContext
    private val arguments = InstrumentationRegistry.getArguments()

    @Test fun holdsALayoutNotificationForAPersonToCheck() {
        val seconds = arguments.getString("liveActivityHold")?.toLongOrNull()
        assumeTrue("Pass -e liveActivityHold <seconds> to run this check", seconds != null)
        if (Build.VERSION.SDK_INT >= 33) {
            instrumentation.uiAutomation.executeShellCommand("pm grant ${context.packageName} ${Manifest.permission.POST_NOTIFICATIONS}").close()
        }
        val port = LayoutNotifications(context, { arguments.getString("samsungNowBar") == "true" })
        val engine = LayoutEngine(LayoutPreferencesStore(context), port)
        ActionHub.register { Log.i(TAG, "tap actionId=${it.actionId} activityId=${it.activityId} activityKey=${it.activityKey}") }
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val canPromote = Build.VERSION.SDK_INT >= 36 && manager.canPostPromotedNotifications()
        val record = engine.start(LayoutInput.start(JSONObject(request(canPromote))))
        Log.i(TAG, "started sdk=${Build.VERSION.SDK_INT} canPostPromoted=$canPromote record=${record.json()}")
        if (Build.VERSION.SDK_INT >= 36) Log.i(TAG, "promotable=${port.build(record).hasPromotableCharacteristics()}")
        val bodies = listOf("안녕하세요, 오늘 회의에서 논의한 내용을 정리합니다.", "Second sentence from the lock screen.", "세 번째 문장입니다 🎙")
        for (step in 1..(seconds!! / 5)) {
            Thread.sleep(5000)
            val values = mapOf("title" to "Listening", "status" to bodies[(step % bodies.size).toInt()], "done" to (step % 10) / 10.0)
            try {
                val updated = engine.update(record.id, LayoutSnapshot(step, values, null))
                Log.i(TAG, "update revision=$step state=${updated.state} promotionState=${engine.list().first { it.id == record.id }.promotionState}")
            } catch (failure: ActivityFailure) {
                Log.i(TAG, "update revision=$step failed code=${failure.code}")
                return
            }
        }
        if (arguments.getString("liveActivityKeep") != "true") engine.end(record.id, "immediate")
        Log.i(TAG, "finished list=${engine.list().map { it.json() }}")
    }

    private fun request(canPromote: Boolean) = """{"activityKey":"hold:session","schemaVersion":2,"fallback":"${if (canPromote) "none" else "notification"}",
        "layout":{"lockScreen":{"type":"vstack","children":[{"type":"hstack","children":[{"type":"symbol","name":"mic"},{"type":"text","bind":"title"}]},
        {"type":"text","bind":"status"},{"type":"progress","bind":"done"},
        {"type":"button","actionId":"stop","child":{"type":"text","value":"Stop"}},
        {"type":"button","actionId":"pause","child":{"type":"text","value":"Pause"}}]}},
        "snapshot":{"revision":0,"values":{"title":"Listening","status":"Waiting for speech","done":0}},"android":{"visibility":"public"}}"""

    private companion object { const val TAG = "LiveActivityHold" }
}
