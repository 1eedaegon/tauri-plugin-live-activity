package io.github.eedaegon.liveactivity

import org.json.JSONArray
import org.json.JSONObject

/** The values of a layout activity at one revision. Values are `String`, `Double` or `Boolean`. */
internal data class LayoutSnapshot(val revision: Long, val values: Map<String, Any>, val staleAt: Long?) {
    val weight: Int get() = weigh(values)
    fun json(): JSONObject = JSONObject().put("revision", revision).put("values", toJson(values))
        .also { if (staleAt != null) it.put("staleAt", staleAt) }
}

/**
 * What a record keeps of its start: the whole [LayoutStart] while the activity lives, and only
 * [LayoutRemains] once it is a stored tombstone.
 */
internal sealed interface LayoutOrigin {
    val activityKey: String
    /** Every action id of the lock screen tree, whatever the conditions. */
    val actionIds: Set<String>
    /** The `layout.*` entries of `degradedFeatures` with these values. */
    fun ignored(values: Map<String, Any>): List<String>
}

/**
 * A start request of contract v2. Structural equality over the whole request is the fingerprint of
 * an idempotent start: a repeat with anything changed, `android` included, is a CONFLICT.
 */
internal data class LayoutStart(
    override val activityKey: String,
    val fallback: String,
    val layout: Map<String, Any>,
    val styles: Map<String, Any>?,
    val snapshot: LayoutSnapshot,
    /** `android.visibility`, or null when the request has no `android` member. */
    val visibility: String?,
) : LayoutOrigin {
    /** Layout and styles, `{}` when there are none: the part of the weight that an update keeps. */
    val documentWeight: Int get() = weigh(layout) + (styles?.let(::weigh) ?: 2)
    val weight: Int get() = documentWeight + snapshot.weight
    override val actionIds: Set<String> by lazy { LayoutProjection.actionIds(layout) }

    override fun ignored(values: Map<String, Any>): List<String> = LayoutProjection.project(this, values).ignored

    fun json(): JSONObject = JSONObject().put("activityKey", activityKey).put("schemaVersion", 2).put("fallback", fallback)
        .put("layout", toJson(layout)).put("snapshot", snapshot.json()).also { json ->
            styles?.let { json.put("styles", toJson(it)) }
            visibility?.let { json.put("android", JSONObject().put("visibility", it)) }
        }
}

/**
 * What a tombstone keeps instead of its start request: no layout, styles or start values, so 128
 * ended activities stay small on disk. Its snapshot never changes, so what its notification left
 * out is kept as it was, and its buttons let a late tap still name the key.
 */
internal data class LayoutRemains(
    override val activityKey: String,
    val ignoredParts: List<String>,
    override val actionIds: Set<String>,
) : LayoutOrigin {
    override fun ignored(values: Map<String, Any>): List<String> = ignoredParts

    fun json(): JSONObject = JSONObject().put("ignored", JSONArray(ignoredParts)).put("actionIds", JSONArray(actionIds.toList()))
}

internal data class LayoutRecord(
    override val id: String,
    val origin: LayoutOrigin,
    override val snapshot: LayoutSnapshot,
    override val state: String = "unknown",
    override val promotionRequested: Boolean = false,
    override val promotionState: String = "notApplicable",
    override val awaitingObservation: Boolean = false,
    override val postFailed: Boolean = false,
) : Entry<LayoutRecord, LayoutSnapshot> {
    override val activityKey: String get() = origin.activityKey

    /** The start request. Only a tombstone has none, and the lifecycle never posts or updates one. */
    val start: LayoutStart get() = origin as? LayoutStart ?: throw ActivityFailure("NATIVE_ERROR", "An ended activity keeps no layout.")

    private val degraded: List<String> by lazy {
        val promotion = if (!promotionRequested || promotionState == "notPromoted") listOf("nativeLiveActivity") else emptyList()
        promotion + origin.ignored(snapshot.values)
    }

    /** The internal form as text, made once per record: every save writes every record. */
    val storedJson: String by lazy { json(internal = true).toString() }

    override fun with(snapshot: LayoutSnapshot, state: String, promotionRequested: Boolean, promotionState: String, awaitingObservation: Boolean, postFailed: Boolean) =
        copy(snapshot = snapshot, state = state, promotionRequested = promotionRequested, promotionState = promotionState, awaitingObservation = awaitingObservation, postFailed = postFailed)

    /** The record of the contract: no template and no layout. The internal form adds what storage needs. */
    fun json(internal: Boolean = false): JSONObject = JSONObject()
        .put("id", id).put("activityKey", activityKey).put("schemaVersion", 2).put("snapshot", snapshot.json())
        .put("backend", "androidNotification").put("state", state).put("visibility", "unknown")
        .put("degradedFeatures", JSONArray(degradedFeatures()))
        .put("promotionRequested", promotionRequested).put("promotionState", promotionState)
        .also { json ->
            if (!internal) return@also
            when (origin) {
                is LayoutStart -> json.put("origin", origin.json())
                is LayoutRemains -> json.put("retired", origin.json())
            }
            json.put("awaitingObservation", awaitingObservation).put("postFailed", postFailed)
        }

    /** `nativeLiveActivity` as in v1, then what the notification does not show of the layout. */
    fun degradedFeatures(): List<String> = degraded

    /** The small form embedded in the notification: no layout. */
    fun extra(): JSONObject = LayoutNotificationExtra(id, snapshot, promotionRequested).json()

    /** Whether the lock screen tree has a button with this action id. */
    fun declares(actionId: String): Boolean = actionId in origin.actionIds

    /** The form kept on disk: a terminal record keeps [LayoutRemains] instead of its start request. */
    fun retired(): LayoutRecord =
        if (terminal && origin is LayoutStart) copy(origin = LayoutRemains(origin.activityKey, origin.ignored(snapshot.values), origin.actionIds)) else this

    companion object {
        fun fromJson(json: JSONObject): LayoutRecord {
            val state = json.getString("state")
            val origin = if (json.has("origin")) LayoutInput.start(json.getJSONObject("origin")) else remains(json, state)
            return LayoutRecord(
                Input.id(json.get("id")), origin, LayoutInput.snapshot(json.getJSONObject("snapshot")), state,
                json.getBoolean("promotionRequested"), json.getString("promotionState"),
                json.optBoolean("awaitingObservation", false), json.optBoolean("postFailed", false),
            )
        }

        /** Only a tombstone is stored without its start request. */
        private fun remains(json: JSONObject, state: String): LayoutRemains {
            val key = json.get("activityKey").text()
            if (state != "ended" && state != "dismissed" || !LayoutRules.isActivityKey(key)) invalidLayout()
            val retired = json.getJSONObject("retired")
            return LayoutRemains(key, strings(retired.getJSONArray("ignored")), strings(retired.getJSONArray("actionIds")).toSet())
        }

        private fun strings(array: JSONArray): List<String> = tree(array).items().map { it.text() }
    }
}

/** What a layout notification carries about itself. */
internal data class LayoutNotificationExtra(val id: String, val snapshot: LayoutSnapshot, val promotionRequested: Boolean) {
    fun json(): JSONObject = JSONObject().put("id", id).put("snapshot", snapshot.json()).put("promotionRequested", promotionRequested)

    companion object {
        fun fromJson(json: JSONObject) = LayoutNotificationExtra(
            Input.id(json.get("id")), LayoutInput.snapshot(json.getJSONObject("snapshot")), json.getBoolean("promotionRequested"),
        )
    }
}

/** The v2 (layout) lifecycle: the v1 rules over a layout and its values. */
internal class LayoutEngine(store: Store<LayoutRecord>, port: Port<LayoutRecord, LayoutSnapshot>) {
    private val lifecycle = Lifecycle(store, port, LayoutContract)

    fun start(request: LayoutStart): LayoutRecord = lifecycle.start(request)
    fun update(id: String, snapshot: LayoutSnapshot): LayoutRecord = lifecycle.update(id, snapshot)
    fun end(id: String, policy: String): LayoutRecord = lifecycle.end(id, policy)
    fun list(): List<LayoutRecord> = lifecycle.list()
}

private object LayoutContract : Contract<LayoutRecord, LayoutStart, LayoutSnapshot> {
    override fun activityKey(request: LayoutStart) = request.activityKey
    override fun fallback(request: LayoutStart) = request.fallback
    override fun revision(snapshot: LayoutSnapshot) = snapshot.revision
    override fun create(id: String, request: LayoutStart, promote: Boolean) = LayoutRecord(
        id, request, request.snapshot, promotionRequested = promote, promotionState = if (promote) "unknown" else "notApplicable", awaitingObservation = true,
    )
    override fun startedBy(record: LayoutRecord, request: LayoutStart) = record.origin == request
    override fun checkReplacement(previous: LayoutRecord, snapshot: LayoutSnapshot) =
        LayoutRules.checkReplacement(previous.start, previous.snapshot.values, snapshot.values)
}
