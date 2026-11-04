package io.github.eedaegon.liveactivity

import org.json.JSONObject

internal object Input {
    private const val MAX_INTEGER = 9007199254740991L
    private const val MAX_TIMESTAMP = 8640000000000000L
    private fun invalid(): Nothing = throw ActivityFailure("INVALID_INPUT", "Invalid activity request.")

    fun keys(json: JSONObject, required: Set<String>, optional: Set<String> = emptySet()) {
        val actual = json.keys().asSequence().toSet()
        if (!actual.containsAll(required) || !((required + optional).containsAll(actual))) invalid()
        if (actual.any { json.isNull(it) }) invalid()
    }

    private fun text(value: Any, maximum: Int): String {
        if (value !is String || value.all(::isContractWhitespace) || value.codePointCount(0, value.length) > maximum) invalid()
        return value
    }

    private fun isContractWhitespace(character: Char): Boolean = character.code.let {
        it in 0x0009..0x000D || it in 0x2000..0x200A || it in setOf(
            0x0020, 0x00A0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
        )
    }

    fun id(value: Any): String = text(value, 256)

    private fun integer(value: Any, maximum: Long): Long {
        if (value !is Number) invalid()
        val number = value.toDouble()
        if (!number.isFinite() || number % 1.0 != 0.0 || number < 0 || number > maximum.toDouble()) invalid()
        return number.toLong()
    }

    fun start(json: JSONObject): StartRequest {
        keys(json, setOf("activityKey", "schemaVersion", "template", "fallback", "snapshot"))
        val key = text(json.get("activityKey"), 128)
        if (!Regex("^[A-Za-z0-9][A-Za-z0-9._:-]*$").matches(key)) invalid()
        if (integer(json.get("schemaVersion"), 1) != 1L) invalid()
        val template = json.get("template")
        val fallback = json.get("fallback")
        if (template !in listOf("progress", "timer") || fallback !in listOf("none", "notification")) invalid()
        val snapshot = snapshot(json.getJSONObject("snapshot"))
        if (snapshot.template != template) invalid()
        return StartRequest(key, 1, template, fallback as String, snapshot)
    }

    fun snapshot(json: JSONObject): Snapshot {
        keys(json, setOf("revision", "title", "status"), setOf("progress", "timer", "staleAt"))
        if (json.has("progress") == json.has("timer")) invalid()
        val revision = integer(json.get("revision"), MAX_INTEGER)
        val title = text(json.get("title"), 120)
        val status = text(json.get("status"), 240)
        val progress = if (json.has("progress")) {
            val number = json.get("progress")
            if (number !is Number || !number.toDouble().isFinite() || number.toDouble() !in 0.0..1.0) invalid()
            number.toDouble()
        } else null
        val timer = if (json.has("timer")) timer(json.getJSONObject("timer")) else null
        val staleAt = if (json.has("staleAt")) integer(json.get("staleAt"), MAX_TIMESTAMP) else null
        return Snapshot(revision, title, status, progress, timer, staleAt)
    }

    private fun timer(json: JSONObject): Timer {
        keys(json, setOf("startedAt", "endsAt"))
        val start = integer(json.get("startedAt"), MAX_TIMESTAMP)
        val end = integer(json.get("endsAt"), MAX_TIMESTAMP)
        if (end <= start) invalid()
        return Timer(start, end)
    }

    fun end(json: JSONObject): Pair<String, String> {
        keys(json, setOf("id", "policy"))
        val policy = json.getJSONObject("policy")
        val kind = policy.get("kind")
        if (kind == "after") {
            keys(policy, setOf("kind", "at"))
            integer(policy.get("at"), MAX_TIMESTAMP)
        } else {
            keys(policy, setOf("kind"))
            if (kind !in listOf("immediate", "default")) invalid()
        }
        return id(json.get("id")) to kind as String
    }
}
