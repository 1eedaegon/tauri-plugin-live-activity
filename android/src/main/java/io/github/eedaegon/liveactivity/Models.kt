package io.github.eedaegon.liveactivity

import org.json.JSONObject

internal class ActivityFailure(val code: String, message: String) : Exception(message)
internal data class Timer(val startedAt: Long, val endsAt: Long) {
    fun json() = JSONObject().put("startedAt", startedAt).put("endsAt", endsAt)
}

internal data class Snapshot(
    val revision: Long,
    val title: String,
    val status: String,
    val progress: Double?,
    val timer: Timer?,
    val staleAt: Long?,
) {
    val template: String get() = if (timer == null) "progress" else "timer"
    fun json(): JSONObject = JSONObject().put("revision", revision).put("title", title)
        .put("status", status).also {
            if (progress != null) it.put("progress", progress)
            if (timer != null) it.put("timer", timer.json())
            if (staleAt != null) it.put("staleAt", staleAt)
        }
}

internal data class StartRequest(
    val activityKey: String,
    val schemaVersion: Int,
    val template: String,
    val fallback: String,
    val snapshot: Snapshot,
) {
    fun json(): JSONObject = JSONObject().put("activityKey", activityKey)
        .put("schemaVersion", schemaVersion).put("template", template)
        .put("fallback", fallback).put("snapshot", snapshot.json())
}

internal data class ActivityRecord(
    override val id: String,
    val origin: StartRequest,
    override val snapshot: Snapshot = origin.snapshot,
    override val state: String = "unknown",
    override val promotionRequested: Boolean = false,
    override val promotionState: String = "notApplicable",
    override val awaitingObservation: Boolean = false,
    override val postFailed: Boolean = false,
) : Entry<ActivityRecord, Snapshot> {
    override val activityKey: String get() = origin.activityKey
    override fun with(snapshot: Snapshot, state: String, promotionRequested: Boolean, promotionState: String, awaitingObservation: Boolean, postFailed: Boolean) =
        copy(snapshot = snapshot, state = state, promotionRequested = promotionRequested, promotionState = promotionState, awaitingObservation = awaitingObservation, postFailed = postFailed)
    fun json(internal: Boolean = false): JSONObject = JSONObject()
        .put("id", id).put("activityKey", origin.activityKey).put("schemaVersion", 1)
        .put("template", origin.template).put("snapshot", snapshot.json())
        .put("backend", "androidNotification").put("state", state).put("visibility", "unknown")
        .put("degradedFeatures", org.json.JSONArray(if (!promotionRequested || promotionState == "notPromoted") listOf("nativeLiveActivity") else emptyList<String>()))
        .put("promotionRequested", promotionRequested).put("promotionState", promotionState)
        .also { if (internal) it.put("origin", origin.json()).put("awaitingObservation", awaitingObservation).put("postFailed", postFailed) }

    companion object {
        fun fromJson(json: JSONObject): ActivityRecord = ActivityRecord(
            Input.id(json.get("id")), Input.start(json.getJSONObject("origin")),
            Input.snapshot(json.getJSONObject("snapshot")), json.getString("state"),
            json.getBoolean("promotionRequested"), json.getString("promotionState"), json.optBoolean("awaitingObservation", false), json.optBoolean("postFailed", false),
        )
    }
}
