package io.github.eedaegon.liveactivity

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

class ActionReceiverTest {
    private val origin = LayoutInput.start(JSONObject("""{"activityKey":"job:1","schemaVersion":2,"fallback":"notification",
        "layout":{"lockScreen":{"type":"button","actionId":"stop","child":{"type":"text","value":"Stop"}}},"snapshot":{"revision":0,"values":{}}}"""))

    private fun tap(id: String, actionId: String, action: String = ACTION_TAPPED) = TestIntent(action, mapOf("id" to id, "actionId" to actionId))

    /** The thread that runs the relay's tasks now. A task that throws ends it and the executor starts another. */
    private fun relayThread(): Thread {
        val thread = LinkedBlockingQueue<Thread>()
        ActionHub.execute { thread.put(Thread.currentThread()) }
        return requireNotNull(thread.poll(5, TimeUnit.SECONDS))
    }

    @Test fun aReceiverCalledWithoutAPendingResultDeliversTapsAndKeepsTheRelayThread() {
        val context = PreferencesContext(MemoryPreferences())
        LayoutPreferencesStore(context).write(listOf(LayoutRecord("known", origin, origin.snapshot, state = "active")))
        val taps = LinkedBlockingQueue<ActionTap>()
        ActionHub.register { taps.put(it) }
        val before = relayThread()
        // Called directly, as a test does, a receiver has no PendingResult: goAsync() returns null.
        ActionReceiver().onReceive(context, tap("known", "other"))
        ActionReceiver().onReceive(context, tap("known", "stop"))
        ActionReceiver().onReceive(context, tap("evicted", "stop"))
        ActionReceiver().onReceive(context, tap("known", "stop", action = "unrelated"))
        assertSame("a task of the relay threw", before, relayThread())
        assertEquals(ActionTap("stop", "known", "job:1"), taps.poll(5, TimeUnit.SECONDS))
        assertEquals(ActionTap("stop", "evicted", null), taps.poll(5, TimeUnit.SECONDS))
        assertNull(taps.poll(100, TimeUnit.MILLISECONDS))
    }
}
