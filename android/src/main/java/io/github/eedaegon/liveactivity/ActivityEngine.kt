package io.github.eedaegon.liveactivity

import java.util.UUID

internal val ACTIVITY_LOCK = Any()
internal interface RecordStore {
    fun read(): List<ActivityRecord>
    fun write(records: List<ActivityRecord>)
}
internal interface NotificationPort {
    fun notificationsAllowed(): Boolean
    fun promotionAllowed(): Boolean
    fun observed(): Map<String, ActivityRecord>
    fun post(record: ActivityRecord)
    fun cancel(id: String)
}

/** Serialized lifecycle decisions; native observations, not disk records, establish active state. */
internal class ActivityEngine(private val store: RecordStore, private val port: NotificationPort) {
    private val activeLimit = 32
    private val tombstoneLimit = 128

    fun start(request: StartRequest): ActivityRecord = synchronized(ACTIVITY_LOCK) {
        ensurePermission()
        val records = reconcile()
        val existing = records.firstOrNull { !it.terminal && it.origin.activityKey == request.activityKey }
        if (existing != null) {
            if (existing.origin != request) fail("CONFLICT", "An activity with this key already exists.")
            return@synchronized if (existing.postFailed) deliver(existing, records) else existing
        }
        val promote = port.promotionAllowed()
        if (!promote && request.fallback == "none") {
            fail("UNSUPPORTED_FEATURE", "Live Update promotion is unavailable; notification fallback was not allowed.")
        }
        if (records.count { !it.terminal } >= activeLimit) fail("SYSTEM_LIMIT", "Too many active activities.")
        val record = ActivityRecord(UUID.randomUUID().toString(), request, promotionRequested = promote, promotionState = if (promote) "unknown" else "notApplicable", awaitingObservation = true)
        deliver(record, records + record)
    }

    fun update(id: String, snapshot: Snapshot): ActivityRecord = synchronized(ACTIVITY_LOCK) {
        val records = reconcile()
        val previous = records.firstOrNull { it.id == id } ?: fail("NOT_FOUND", "Unknown activity.")
        if (previous.terminal || (previous.state == "unknown" && !previous.awaitingObservation)) fail("NOT_FOUND", "Activity is no longer observable as active.")
        if (snapshot.template != previous.origin.template) fail("INVALID_INPUT", "An activity cannot change template.")
        if (snapshot.revision < previous.snapshot.revision) fail("STALE_REVISION", "Activity revision is stale.")
        if (snapshot.revision == previous.snapshot.revision) {
            if (snapshot != previous.snapshot) fail("CONFLICT", "Revision already contains different content.")
            return@synchronized if (previous.postFailed) deliver(previous, records) else previous
        }
        ensurePermission()
        val record = previous.copy(snapshot = snapshot, state = "unknown", awaitingObservation = true)
        deliver(record, records)
    }

    fun end(id: String, policy: String): ActivityRecord = synchronized(ACTIVITY_LOCK) {
        val records = reconcile()
        val previous = records.firstOrNull { it.id == id } ?: fail("NOT_FOUND", "Unknown activity.")
        if (policy == "after") fail("UNSUPPORTED_FEATURE", "Android does not support delayed activity dismissal.")
        if (previous.state == "ended") return@synchronized previous
        val ended = previous.copy(state = "ended")
        save(records.filter { it.id != id } + ended)
        port.cancel(id)
        ended
    }

    fun list(): List<ActivityRecord> = synchronized(ACTIVITY_LOCK) { reconcile() }

    private fun reconcile(): List<ActivityRecord> {
        val stored = store.read()
        val observed = port.observed()
        val reconciled = stored.map { previous ->
            when {
                DismissalMemory.contains(previous.id) -> previous.copy(state = "dismissed", awaitingObservation = false, postFailed = false)
                previous.terminal -> {
                    if (observed.containsKey(previous.id)) port.cancel(previous.id)
                    previous
                }
                observed.containsKey(previous.id) -> {
                    val native = observed.getValue(previous.id)
                    if (previous.awaitingObservation && native.snapshot.revision < previous.snapshot.revision) previous
                    else native.copy(origin = previous.origin, awaitingObservation = false, postFailed = false)
                }
                previous.state == "active" || previous.state == "stale" -> previous.copy(state = "dismissed")
                else -> previous.copy(state = "unknown")
            }
        }
        if (reconciled != stored) {
            val previousTerminalIds = stored.filter { it.terminal }.map { it.id }.toSet()
            save(reconciled.sortedBy { if (it.terminal && it.id !in previousTerminalIds) 1 else 0 })
        }
        return reconciled
    }

    private fun deliver(record: ActivityRecord, records: List<ActivityRecord>): ActivityRecord {
        // Write ahead: a crash, post failure, or failed follow-up write must leave a retryable receipt.
        val pending = record.copy(postFailed = true, promotionState = if (record.promotionRequested) "unknown" else "notApplicable")
        val next = records.map { if (it.id == record.id) pending else it }
        save(next)
        port.post(pending)
        save(next.map { if (it.id == record.id) pending.copy(postFailed = false) else it })
        return reconcile().first { it.id == record.id }
    }

    private fun save(records: List<ActivityRecord>) {
        val active = records.filter { !it.terminal }
        val ended = records.filter { it.terminal }.takeLast(tombstoneLimit)
        store.write(active + ended)
        (active + ended).filter { it.terminal }.forEach { DismissalMemory.forget(it.id) }
    }

    private fun ensurePermission() {
        if (!port.notificationsAllowed()) fail("PERMISSION_DENIED", "Notifications are disabled for this app or channel.")
    }

    private fun fail(code: String, message: String): Nothing = throw ActivityFailure(code, message)
}
