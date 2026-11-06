package io.github.eedaegon.liveactivity

import org.json.JSONObject
import java.util.concurrent.Executor
import java.util.concurrent.Executors

/** A tap on a layout button, as Rust's `ActionEvent` reads it. */
internal data class ActionTap(val actionId: String, val activityId: String, val activityKey: String?) {
    fun json(): JSONObject = JSONObject().put("actionId", actionId).put("activityId", activityId)
        .also { json -> activityKey?.let { json.put("activityKey", it) } }
}

/**
 * Hands taps to the channel that Rust registered, one at a time on the relay's executor. Rust's
 * channel closure returns once its handlers have run (at most 4 s), so it must not run on the main
 * thread: a handler may call the plugin, whose commands run there. Taps that arrive before a channel
 * is registered are kept in memory, the newest [limit], and delivered when it is. Nothing is written
 * to disk, so a tap cannot fire in a later process.
 */
internal class ActionRelay(private val executor: Executor, private val limit: Int = 16) {
    // Touched on the executor only.
    private var sink: ((ActionTap) -> Unit)? = null
    private val pending = ArrayDeque<ActionTap>()

    fun register(sink: (ActionTap) -> Unit) = executor.execute {
        this.sink = sink
        while (pending.isNotEmpty()) deliver(sink, pending.removeFirst())
    }

    /** Delivers or keeps `tap`, then calls `done` on the executor. */
    fun offer(tap: ActionTap, done: () -> Unit = {}) = executor.execute {
        try {
            val current = sink
            if (current != null) deliver(current, tap)
            else {
                if (pending.size == limit) pending.removeFirst()
                pending.addLast(tap)
            }
        } finally { done() }
    }

    /** Runs `task` on the executor, after the taps offered before it. */
    fun execute(task: () -> Unit) = executor.execute(task)

    private fun deliver(sink: (ActionTap) -> Unit, tap: ActionTap) {
        // A failing channel must not stop the taps that follow.
        try { sink(tap) } catch (_: Exception) {}
    }

    companion object {
        fun background() = ActionRelay(Executors.newSingleThreadExecutor { task -> Thread(task, "live-activity-actions").apply { isDaemon = true } })
    }
}

/** The process-wide relay between [ActionReceiver] and the plugin's `registerActions` command. */
internal val ActionHub = ActionRelay.background()

internal object ActionTaps {
    /**
     * The tap to deliver for button `actionId` of activity `id`, or null to drop it. A known
     * activity names its key and must declare the button; an unknown one (never stored, or an
     * evicted tombstone) is delivered without a key, as the contract allows.
     */
    fun resolve(records: List<LayoutRecord>, id: String, actionId: String): ActionTap? {
        val record = records.firstOrNull { it.id == id } ?: return ActionTap(actionId, id, null)
        return if (record.declares(actionId)) ActionTap(actionId, id, record.activityKey) else null
    }
}
