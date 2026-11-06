package io.github.eedaegon.liveactivity

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit

class ActionRelayTest {
    private val direct = Executor { it.run() }
    private fun tap(action: String) = ActionTap(action, "id", null)

    @Test fun tapsBeforeTheChannelWaitForItAndOnlyTheNewest16AreKept() {
        val relay = ActionRelay(direct)
        var done = 0
        repeat(18) { relay.offer(tap("$it")) { done += 1 } }
        assertEquals(18, done)
        val seen = mutableListOf<String>()
        relay.register { seen += it.actionId }
        assertEquals((2 until 18).map { "$it" }, seen)
        relay.offer(tap("live"))
        assertEquals("live", seen.last())
        assertEquals(17, seen.size)
    }

    @Test fun aFailingSinkDoesNotStopLaterTapsAndTheLatestChannelWins() {
        val relay = ActionRelay(direct)
        relay.register { if (it.actionId == "boom") throw IllegalStateException("raised by this test") }
        var finished = false
        relay.offer(tap("boom")) { finished = true }
        assertTrue(finished)
        val seen = mutableListOf<String>()
        relay.register { seen += it.actionId }
        relay.offer(tap("next"))
        assertEquals(listOf("next"), seen)
    }

    @Test fun theBackgroundRelayDeliversOffTheCallingThread() {
        val relay = ActionRelay.background()
        val latch = CountDownLatch(1)
        var thread: Thread? = null
        relay.register { thread = Thread.currentThread(); latch.countDown() }
        relay.offer(tap("play"))
        assertTrue(latch.await(5, TimeUnit.SECONDS))
        assertNotEquals(Thread.currentThread(), thread)
        assertEquals("live-activity-actions", thread!!.name)
        assertTrue(thread!!.isDaemon)
    }

    @Test fun aTapNamesTheKeyOfAKnownActivityAndOnlyItsDeclaredButtons() {
        val origin = LayoutInput.start(JSONObject("""{"activityKey":"job:1","schemaVersion":2,"fallback":"notification",
            "layout":{"lockScreen":{"type":"button","actionId":"stop","child":{"type":"text","value":"Stop"}}},"snapshot":{"revision":0,"values":{}}}"""))
        val records = listOf(LayoutRecord("known", origin, origin.snapshot, state = "ended"))
        assertEquals(ActionTap("stop", "known", "job:1"), ActionTaps.resolve(records, "known", "stop"))
        assertNull(ActionTaps.resolve(records, "known", "other"))
        assertEquals(ActionTap("stop", "evicted", null), ActionTaps.resolve(records, "evicted", "stop"))
    }

    @Test fun theEventLeavesOutAnUnknownKey() {
        assertEquals(setOf("actionId", "activityId"), ActionTap("stop", "id", null).json().keys().asSequence().toSet())
        val known = ActionTap("stop", "id", "job:1").json()
        assertEquals("job:1", known.getString("activityKey"))
        assertFalse(known.has("timestamp"))
    }
}
