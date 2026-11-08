package io.github.eedaegon.liveactivity

import kotlin.math.abs

/**
 * Strict parsing of request contract v2, with the rules of docs/request-contract.md and the
 * verdicts of tests/fixtures/layout-requests.json. A broken rule is INVALID_INPUT; the weight is
 * checked last and is PAYLOAD_TOO_LARGE. Nothing is corrected and no message repeats input.
 */
internal object LayoutInput {
    private val FALLBACKS = setOf("none", "notification")
    private val VISIBILITIES = setOf("public", "private", "secret")
    private val POLICIES = setOf("immediate", "default")

    fun start(input: Any?): LayoutStart {
        val request = tree(input).members()
            .only(setOf("activityKey", "schemaVersion", "fallback", "layout", "snapshot"), setOf("styles", "android"))
        val key = request["activityKey"].text()
        if (!LayoutRules.isActivityKey(key) || request["schemaVersion"].number() != 2.0) invalidLayout()
        val fallback = request["fallback"].oneOf(FALLBACKS)
        val snapshot = shape(request["snapshot"])
        val styles = request["styles"]?.members()?.also(LayoutRules::checkStyles)
        val visibility = request["android"]?.let { it.members().only(setOf("visibility"))["visibility"].oneOf(VISIBILITIES) }
        val layout = request["layout"].members()
        LayoutRules.checkLayout(layout, styles, snapshot.values)
        val start = LayoutStart(key, fallback, layout, styles, snapshot, visibility)
        if (start.weight > LayoutRules.MAX_WEIGHT) LayoutRules.tooLarge()
        return start
    }

    fun update(input: Any?): Pair<String, LayoutSnapshot> {
        val request = tree(input).members().only(setOf("id", "snapshot"))
        return handle(request["id"]) to snapshotOf(request["snapshot"])
    }

    /** An end, with its optional final content checked as the snapshot of an update is checked alone. */
    fun end(input: Any?): LayoutEnd {
        val request = tree(input).members().only(setOf("id", "policy"), setOf("snapshot"))
        val id = handle(request["id"])
        val policy = request["policy"].members()
        val kind = policy["kind"].text()
        if (kind == "after") policy.only(setOf("kind", "at"))["at"].integer(LayoutRules.MAX_TIMESTAMP)
        else if (kind !in POLICIES || policy.size != 1) invalidLayout()
        // A `null` snapshot is JsonNull here, not a missing member, so it fails as a snapshot.
        return LayoutEnd(id, kind, request["snapshot"]?.let(::snapshotOf))
    }

    /** A snapshot as JSON: every rule of its own, the weight of its values included. */
    fun snapshot(input: Any?): LayoutSnapshot = snapshotOf(tree(input))

    private fun snapshotOf(raw: Any?): LayoutSnapshot {
        val snapshot = shape(raw)
        if (snapshot.weight > LayoutRules.MAX_WEIGHT) LayoutRules.tooLarge()
        return snapshot
    }

    /** Every rule of a snapshot but the weight. */
    private fun shape(raw: Any?): LayoutSnapshot {
        val snapshot = raw.members().only(setOf("revision", "values"), setOf("staleAt", "timestamp"))
        val revision = snapshot["revision"].integer(LayoutRules.MAX_REVISION)
        val values = snapshot["values"].members()
        if (values.size > 32) invalidLayout()
        values.forEach { (key, value) -> if (!LayoutRules.isName(key)) invalidLayout(); value(value) }
        return LayoutSnapshot(
            revision, values, snapshot["staleAt"]?.integer(LayoutRules.MAX_TIMESTAMP), snapshot["timestamp"]?.integer(LayoutRules.MAX_TIMESTAMP),
        )
    }

    private fun value(value: Any) {
        when (value) {
            is String -> if (value.codePointLength() > 1000) invalidLayout()
            is Double -> if (!value.isFinite() || abs(value) > LayoutRules.MAX_NUMBER) invalidLayout()
            is Boolean -> Unit
            else -> invalidLayout()
        }
    }

    /** The v1 handle rule: 1 to 256 code points with one that is not whitespace. */
    private fun handle(raw: Any?): String = if (raw is String) Input.id(raw) else invalidLayout()
}
