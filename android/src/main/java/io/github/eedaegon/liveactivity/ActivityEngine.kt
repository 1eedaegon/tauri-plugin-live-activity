package io.github.eedaegon.liveactivity

internal interface RecordStore : Store<ActivityRecord> {
    override fun read(): List<ActivityRecord>
    override fun write(records: List<ActivityRecord>)
}
internal interface NotificationPort {
    fun notificationsAllowed(): Boolean
    fun promotionAllowed(): Boolean
    fun observed(): Map<String, ActivityRecord>
    fun post(record: ActivityRecord)
    fun cancel(id: String)
}

/** The v1 (template) lifecycle: the shared rules over progress and timer snapshots. */
internal class ActivityEngine(store: RecordStore, port: NotificationPort) {
    private val lifecycle = Lifecycle(store, TemplatePort(port), TemplateContract)

    fun start(request: StartRequest): ActivityRecord = lifecycle.start(request)
    fun update(id: String, snapshot: Snapshot): ActivityRecord = lifecycle.update(id, snapshot)
    fun end(id: String, policy: String): ActivityRecord = lifecycle.end(id, policy)
    fun list(): List<ActivityRecord> = lifecycle.list()
}

private object TemplateContract : Contract<ActivityRecord, StartRequest, Snapshot> {
    override fun activityKey(request: StartRequest) = request.activityKey
    override fun fallback(request: StartRequest) = request.fallback
    override fun revision(snapshot: Snapshot) = snapshot.revision
    override fun create(id: String, request: StartRequest, promote: Boolean) = ActivityRecord(
        id, request, promotionRequested = promote, promotionState = if (promote) "unknown" else "notApplicable", awaitingObservation = true,
    )
    override fun startedBy(record: ActivityRecord, request: StartRequest) = record.origin == request
    override fun checkReplacement(previous: ActivityRecord, snapshot: Snapshot) {
        if (snapshot.template != previous.origin.template) throw ActivityFailure("INVALID_INPUT", "An activity cannot change template.")
    }
}

/** The v1 port reports whole records; the lifecycle reads what it needs from them. */
private class TemplatePort(private val port: NotificationPort) : Port<ActivityRecord, Snapshot> {
    override fun notificationsAllowed() = port.notificationsAllowed()
    override fun promotionAllowed() = port.promotionAllowed()
    override fun observed() = port.observed().mapValues { (_, native) ->
        Observation(native.snapshot, native.state, native.promotionRequested, native.promotionState)
    }
    override fun post(record: ActivityRecord) = port.post(record)
    override fun cancel(id: String) = port.cancel(id)
}
