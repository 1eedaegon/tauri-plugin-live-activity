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
    val id: String,
    val origin: StartRequest,
    val snapshot: Snapshot = origin.snapshot,
    val state: String = "unknown",
    val promotionRequested: Boolean = false,
    val promotionState: String = "notApplicable",
    val awaitingObservation: Boolean = false,
    val postFailed: Boolean = false,
) {
    val terminal: Boolean get() = state == "ended" || state == "dismissed"
    fun json(internal: Boolean = false): JSONObject = JSONObject()
        .put("id", id).put("activityKey", origin.activityKey).put("schemaVersion", 1)
        .put("template", origin.template).put("snapshot", snapshot.json())
        .put("backend", "androidNotification").put("state", state).put("visibility", "unknown")
        .put("degradedFeatures", org.json.JSONArray(if (promotionRequested) emptyList<String>() else listOf("nativeLiveActivity")))
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
