package io.github.eedaegon.liveactivity

import java.util.UUID

internal val ACTIVITY_LOCK = Any()

internal interface Store<E> {
    fun read(): List<E>
    fun write(records: List<E>)
}

/** What a posted notification shows for one activity: its embedded snapshot and the observed state. */
internal data class Observation<S>(
    val snapshot: S,
    val state: String,
    val promotionRequested: Boolean,
    val promotionState: String,
)

internal interface Port<E, S> {
    fun notificationsAllowed(): Boolean
    fun promotionAllowed(): Boolean
    fun observed(): Map<String, Observation<S>>
    fun post(record: E)
    fun cancel(id: String)
}

/** One stored activity of a contract version with its latest snapshot `S`. */
internal interface Entry<E : Entry<E, S>, S> {
    val id: String
    val activityKey: String
    val snapshot: S
    val state: String
    val promotionRequested: Boolean
    val promotionState: String
    val awaitingObservation: Boolean
    val postFailed: Boolean
    val terminal: Boolean get() = state == "ended" || state == "dismissed"
    fun with(
        snapshot: S = this.snapshot,
        state: String = this.state,
        promotionRequested: Boolean = this.promotionRequested,
        promotionState: String = this.promotionState,
        awaitingObservation: Boolean = this.awaitingObservation,
        postFailed: Boolean = this.postFailed,
    ): E
}

/** What differs between the contract versions; `O` is a start request. */
internal interface Contract<E, O, S> {
    fun activityKey(request: O): String
    fun fallback(request: O): String
    fun revision(snapshot: S): Long
    fun create(id: String, request: O, promote: Boolean): E
    /** Whether the live `record` was started by exactly `request`. */
    fun startedBy(record: E, request: O): Boolean
    /** Throws unless `snapshot` may replace the snapshot of `previous`. */
    fun checkReplacement(previous: E, snapshot: S)
}

/** Serialized lifecycle decisions; native observations, not disk records, establish active state. */
internal class Lifecycle<E : Entry<E, S>, O, S>(
    private val store: Store<E>,
    private val port: Port<E, S>,
    private val contract: Contract<E, O, S>,
) {
    private val activeLimit = 32
    private val tombstoneLimit = 128

    fun start(request: O): E = synchronized(ACTIVITY_LOCK) {
        ensurePermission()
        val records = reconcile()
        val key = contract.activityKey(request)
        val existing = records.firstOrNull { !it.terminal && it.activityKey == key }
        if (existing != null) {
            if (!contract.startedBy(existing, request)) fail("CONFLICT", "An activity with this key already exists.")
            return@synchronized if (existing.postFailed) deliver(existing, records) else existing
        }
        val promote = port.promotionAllowed()
        if (!promote && contract.fallback(request) == "none") {
            fail("UNSUPPORTED_FEATURE", "Live Update promotion is unavailable; notification fallback was not allowed.")
        }
        if (records.count { !it.terminal } >= activeLimit) fail("SYSTEM_LIMIT", "Too many active activities.")
        val record = contract.create(UUID.randomUUID().toString(), request, promote)
        deliver(record, records + record)
    }

    fun update(id: String, snapshot: S): E = synchronized(ACTIVITY_LOCK) {
        val records = reconcile()
        val previous = records.firstOrNull { it.id == id } ?: fail("NOT_FOUND", "Unknown activity.")
        if (previous.terminal || (previous.state == "unknown" && !previous.awaitingObservation)) fail("NOT_FOUND", "Activity is no longer observable as active.")
        if (!replaces(previous, snapshot)) return@synchronized if (previous.postFailed) deliver(previous, records) else previous
        ensurePermission()
        val record = previous.with(snapshot = snapshot, state = "unknown", awaitingObservation = true)
        deliver(record, records)
    }

    /**
     * Ends the activity, with `snapshot` as its final content when there is one. No end leaves a
     * notification on Android, so the final content is what the returned and stored records carry.
     */
    fun end(id: String, policy: String, snapshot: S? = null): E = synchronized(ACTIVITY_LOCK) {
        val records = reconcile()
        val previous = records.firstOrNull { it.id == id } ?: fail("NOT_FOUND", "Unknown activity.")
        if (policy == "after") fail("UNSUPPORTED_FEATURE", "Android does not support delayed activity dismissal.")
        if (previous.state == "ended") return@synchronized previous
        val ended = previous.with(snapshot = finalContent(previous, snapshot), state = "ended")
        save(records.filter { it.id != id } + ended)
        port.cancel(id)
        ended
    }

    fun list(): List<E> = synchronized(ACTIVITY_LOCK) { reconcile() }

    /**
     * Whether `snapshot` is new content for `previous` under the rules of an update: the contract's
     * check, STALE_REVISION below the current revision, and at that revision CONFLICT unless the
     * content is the same, which is not new.
     */
    private fun replaces(previous: E, snapshot: S): Boolean {
        contract.checkReplacement(previous, snapshot)
        val revision = contract.revision(snapshot)
        val current = contract.revision(previous.snapshot)
        if (revision < current) fail("STALE_REVISION", "Activity revision is stale.")
        if (revision > current) return true
        if (snapshot != previous.snapshot) fail("CONFLICT", "Revision already contains different content.")
        return false
    }

    /**
     * The content an activity ends with: final content that an update could bring, or else the
     * accepted snapshot. A dismissed activity is shown nowhere and its tombstone keeps no layout to
     * check final content against, so it ends with what it had, as without final content.
     */
    private fun finalContent(previous: E, snapshot: S?): S =
        if (snapshot != null && !previous.terminal && replaces(previous, snapshot)) snapshot else previous.snapshot

    private fun reconcile(): List<E> = settle(store.read(), always = false)

    /** `stored` with what the system shows now; saved when that changed something, or `always`. */
    private fun settle(stored: List<E>, always: Boolean): List<E> {
        val observed = port.observed()
        val reconciled = stored.map { reconciled(it, observed[it.id]) }
        if (always || reconciled != stored) {
            val previousTerminalIds = stored.filter { it.terminal }.map { it.id }.toSet()
            save(reconciled.sortedBy { if (it.terminal && it.id !in previousTerminalIds) 1 else 0 })
        }
        return reconciled
    }

    private fun reconciled(previous: E, native: Observation<S>?): E = when {
        DismissalMemory.contains(previous.id) -> previous.with(state = "dismissed", awaitingObservation = false, postFailed = false)
        previous.terminal -> {
            if (native != null) port.cancel(previous.id)
            previous
        }
        native != null -> {
            if (previous.awaitingObservation && contract.revision(native.snapshot) < contract.revision(previous.snapshot)) previous
            else previous.with(
                snapshot = native.snapshot, state = native.state, promotionRequested = native.promotionRequested,
                promotionState = native.promotionState, awaitingObservation = false, postFailed = false,
            )
        }
        previous.state == "active" || previous.state == "stale" -> previous.with(state = "dismissed")
        else -> previous.with(state = "unknown")
    }

    private fun deliver(record: E, records: List<E>): E {
        // Write ahead: a crash, post failure, or failed follow-up write must leave a retryable receipt.
        val pending = record.with(postFailed = true, promotionState = if (record.promotionRequested) "unknown" else "notApplicable")
        val next = records.map { if (it.id == record.id) pending else it }
        save(next)
        port.post(pending)
        // One follow-up write holds the confirmed post and what the system shows by now. The answer
        // is read back, so it is what the next command reads.
        settle(retained(next.map { if (it.id == record.id) pending.with(postFailed = false) else it }), always = true)
        return store.read().first { it.id == record.id }
    }

    /** The records a save keeps: every live one, then the newest tombstones. */
    private fun retained(records: List<E>): List<E> =
        records.filter { !it.terminal } + records.filter { it.terminal }.takeLast(tombstoneLimit)

    private fun save(records: List<E>) {
        val kept = retained(records)
        store.write(kept)
        kept.filter { it.terminal }.forEach { DismissalMemory.forget(it.id) }
    }

    private fun ensurePermission() {
        if (!port.notificationsAllowed()) fail("PERMISSION_DENIED", "Notifications are disabled for this app or channel.")
    }

    private fun fail(code: String, message: String): Nothing = throw ActivityFailure(code, message)
}
