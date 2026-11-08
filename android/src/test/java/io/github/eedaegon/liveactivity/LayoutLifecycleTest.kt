package io.github.eedaegon.liveactivity

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class LayoutLifecycleTest {
    private val request = LayoutInput.start(JSONObject("""{"activityKey":"fremen:session","schemaVersion":2,"fallback":"notification",
        "layout":{"lockScreen":{"type":"vstack","children":[{"type":"text","bind":"title"},{"type":"symbol","name":"mic"},
        {"type":"button","actionId":"stop","child":{"type":"text","value":"Stop"}}]}},"snapshot":{"revision":0,"values":{"title":"Listening","n":1}}}"""))
    private fun snapshot(revision: Long, title: String = "Listening", n: Double = 1.0) = LayoutSnapshot(revision, mapOf("title" to title, "n" to n), null)

    private class MemoryLayoutStore : Store<LayoutRecord> {
        var records: List<LayoutRecord> = emptyList()
        override fun read() = records
        override fun write(records: List<LayoutRecord>) { this.records = records.toList() }
    }

    private class FakeLayoutPort : Port<LayoutRecord, LayoutSnapshot> {
        var promotion = false
        var posted: List<LayoutRecord> = emptyList()
        var visible: Map<String, Observation<LayoutSnapshot>> = emptyMap()
        override fun notificationsAllowed() = true
        override fun promotionAllowed() = promotion
        override fun observed() = visible
        override fun post(record: LayoutRecord) {
            posted = posted + record
            visible = visible + (record.id to Observation(record.snapshot, "active", record.promotionRequested, if (promotion) "promoted" else "notApplicable"))
        }
        override fun cancel(id: String) { visible = visible - id }
    }

    private fun code(action: () -> Unit): String {
        try { action(); fail("Expected a failure") } catch (failure: ActivityFailure) { return failure.code }
        throw AssertionError()
    }

    @Test fun startIsIdempotentByTheWholeRequestAndEndNeverReusesAHandle() {
        val port = FakeLayoutPort(); val engine = LayoutEngine(MemoryLayoutStore(), port)
        val first = engine.start(request)
        assertEquals("active", first.state)
        assertEquals(first.id, engine.start(request).id)
        assertEquals(1, port.posted.size)
        assertEquals("CONFLICT", code { engine.start(request.copy(fallback = "none")) })
        assertEquals("CONFLICT", code { engine.start(request.copy(visibility = "private")) })
        engine.update(first.id, snapshot(1, "Paused"))
        assertEquals(first.id, engine.start(request).id)
        assertEquals("ended", engine.end(first.id, "immediate").state)
        assertEquals("ended", engine.end(first.id, "default").state)
        assertNotEquals(first.id, engine.start(request).id)
        assertEquals("NOT_FOUND", code { engine.update(first.id, snapshot(2)) })
    }

    @Test fun revisionsAndValuesFollowTheV1Rules() {
        val port = FakeLayoutPort(); val engine = LayoutEngine(MemoryLayoutStore(), port)
        val first = engine.start(request)
        engine.update(first.id, snapshot(2, "Two"))
        assertEquals("STALE_REVISION", code { engine.update(first.id, snapshot(1)) })
        assertEquals("CONFLICT", code { engine.update(first.id, snapshot(2, "Other")) })
        assertEquals(2, engine.update(first.id, snapshot(2, "Two")).snapshot.revision)
        assertEquals(2, port.posted.size)
        assertEquals("INVALID_INPUT", code { engine.update(first.id, LayoutSnapshot(3, mapOf("title" to "x"), null)) })
        assertEquals("INVALID_INPUT", code { engine.update(first.id, LayoutSnapshot(3, mapOf("title" to "x", "n" to "1"), null)) })
        assertEquals("PAYLOAD_TOO_LARGE", code { engine.update(first.id, snapshot(3, "x".repeat(3400))) })
        assertEquals("NOT_FOUND", code { engine.update("unknown", snapshot(3)) })
        assertEquals("NOT_FOUND", code { engine.end("unknown", "immediate") })
        assertEquals("UNSUPPORTED_FEATURE", code { engine.end(first.id, "after") })
        assertEquals("Two", (port.posted.last().snapshot.values["title"]))
    }

    @Test fun strictFallbackNeedsPromotionAndADismissalIsATombstone() {
        val port = FakeLayoutPort(); val store = MemoryLayoutStore(); val engine = LayoutEngine(store, port)
        assertEquals("UNSUPPORTED_FEATURE", code { engine.start(request.copy(fallback = "none")) })
        port.promotion = true
        val record = engine.start(request.copy(fallback = "none"))
        assertEquals("promoted", record.promotionState)
        port.visible = emptyMap()
        assertEquals("dismissed", LayoutEngine(store, port).list().single().state)
        assertEquals("NOT_FOUND", code { engine.update(record.id, snapshot(1)) })
        assertEquals(1, port.posted.size)
    }

    @Test fun v1AndV2ActivitiesDoNotSeeEachOther() {
        val v1 = ActivityEngine(object : RecordStore {
            var records: List<ActivityRecord> = emptyList()
            override fun read() = records
            override fun write(records: List<ActivityRecord>) { this.records = records }
        }, object : NotificationPort {
            override fun notificationsAllowed() = true
            override fun promotionAllowed() = false
            override fun observed() = emptyMap<String, ActivityRecord>()
            override fun post(record: ActivityRecord) {}
            override fun cancel(id: String) {}
        })
        val v2 = LayoutEngine(MemoryLayoutStore(), FakeLayoutPort())
        val template = v1.start(StartRequest("fremen:session", 1, "progress", "notification", Snapshot(0, "Title", "Status", 0.5, null, null)))
        val layout = v2.start(request)
        assertEquals("NOT_FOUND", code { v1.end(layout.id, "immediate") })
        assertEquals("NOT_FOUND", code { v2.end(template.id, "immediate") })
        assertEquals(listOf(template.id), v1.list().map { it.id })
        assertEquals(listOf(layout.id), v2.list().map { it.id })
    }

    @Test fun aMinusZeroIsReadAsZeroSoARetryThroughStorageIsIdempotent() {
        // serde_json writes a Rust f64 minus zero as -0.0, where JSON.stringify writes 0.
        val text = """{"activityKey":"rust:zero","schemaVersion":2,"fallback":"notification",
            "layout":{"lockScreen":{"type":"vstack","spacing":-0.0,"children":[{"type":"text","bind":"delta"}]}},"snapshot":{"revision":0,"values":{"delta":-0.0}}}"""
        val port = JsonLayoutPort(); val engine = LayoutEngine(JsonLayoutStore(), port)
        val first = engine.start(LayoutInput.start(JSONObject(text)))
        assertEquals(first.id, engine.start(LayoutInput.start(JSONObject(text))).id)
        val update = """{"id":"${first.id}","snapshot":{"revision":1,"values":{"delta":-0.0}}}"""
        fun send() = LayoutInput.update(JSONObject(update)).let { (id, snapshot) -> engine.update(id, snapshot) }
        assertEquals(1L, send().snapshot.revision)
        assertEquals(1L, send().snapshot.revision)
        assertEquals(2, port.posts)
        val accepted = LayoutInput.start(JSONObject(text))
        assertEquals(LayoutInput.start(JSONObject(text.replace("-0.0", "0"))), accepted)
        assertEquals(Double.POSITIVE_INFINITY, 1 / (accepted.snapshot.values.getValue("delta") as Double), 0.0)
    }

    // TP-ANDROID-1
    @Test fun aSnapshotTimestampIsKeptAtStartUpdateAndEndAndWrittenBack() {
        val preferences = MemoryPreferences()
        val port = JsonLayoutPort()
        val engine = LayoutEngine(LayoutPreferencesStore(PreferencesContext(preferences)), port)
        fun stored() = JSONArray(preferences.getString(LayoutPreferencesStore.LAYOUT_RECORDS, null)).getJSONObject(0)
        fun shown(record: LayoutRecord) = record.json().getJSONObject("snapshot")

        val start = LayoutInput.start(request.json().also { it.getJSONObject("snapshot").put("timestamp", 0) })
        val started = engine.start(start)
        assertEquals(0L, shown(started).getLong("timestamp"))
        assertEquals(0L, stored().getJSONObject("origin").getJSONObject("snapshot").getLong("timestamp"))
        assertEquals(started.id, engine.start(start).id)
        assertEquals("CONFLICT", code { engine.start(start.copy(snapshot = start.snapshot.copy(timestamp = 1))) })

        fun send(snapshot: String) = LayoutInput.update(JSONObject("""{"id":"${started.id}","snapshot":$snapshot}""")).let { (id, next) -> engine.update(id, next) }
        val stamped = """{"revision":1,"values":{"title":"Paused","n":1},"timestamp":1790000000000}"""
        val updated = send(stamped)
        assertEquals(1790000000000L, shown(updated).getLong("timestamp"))
        // The notification carries it too, so what the system shows is the accepted snapshot and a retry is idempotent.
        assertEquals(updated.snapshot, engine.list().single().snapshot)
        assertEquals(updated.snapshot, send(stamped).snapshot)
        assertEquals(2, port.posts)
        assertEquals("CONFLICT", code { send("""{"revision":1,"values":{"title":"Paused","n":1},"timestamp":1790000000001}""") })
        assertEquals("CONFLICT", code { send("""{"revision":1,"values":{"title":"Paused","n":1}}""") })
        assertFalse(shown(send("""{"revision":2,"values":{"title":"Paused","n":1}}""")).has("timestamp"))

        val end = LayoutInput.end(JSONObject("""{"id":"${started.id}","policy":{"kind":"immediate"},
            "snapshot":{"revision":3,"values":{"title":"Done","n":1},"timestamp":1790000060000}}"""))
        val ended = engine.end(end.id, end.policy, end.snapshot)
        assertEquals(1790000060000L, shown(ended).getLong("timestamp"))
        // The tombstone on disk keeps it, and a later process reads it back.
        assertEquals(1790000060000L, stored().getJSONObject("snapshot").getLong("timestamp"))
        assertEquals(1790000060000L, LayoutRecord.fromJson(stored()).snapshot.timestamp)
    }

    // TP-ANDROID-2
    @Test fun anEndWithFinalContentIsCheckedAsAnUpdateAndKeptInTheRecords() {
        val preferences = MemoryPreferences()
        val port = JsonLayoutPort()
        val engine = LayoutEngine(LayoutPreferencesStore(PreferencesContext(preferences)), port)
        val first = engine.start(request)
        engine.update(first.id, snapshot(2, "Two"))
        assertEquals("STALE_REVISION", code { engine.end(first.id, "immediate", snapshot(1, "Done")) })
        assertEquals("CONFLICT", code { engine.end(first.id, "immediate", snapshot(2, "Done")) })
        assertEquals("INVALID_INPUT", code { engine.end(first.id, "immediate", LayoutSnapshot(3, mapOf("title" to "Done", "n" to 1.0, "more" to 1.0), null)) })
        assertEquals("INVALID_INPUT", code { engine.end(first.id, "immediate", LayoutSnapshot(3, mapOf("title" to "Done"), null)) })
        assertEquals("INVALID_INPUT", code { engine.end(first.id, "immediate", LayoutSnapshot(3, mapOf("title" to "Done", "n" to "1"), null)) })
        assertEquals("PAYLOAD_TOO_LARGE", code { engine.end(first.id, "immediate", snapshot(3, "x".repeat(3400))) })
        assertEquals("UNSUPPORTED_FEATURE", code { engine.end(first.id, "after", snapshot(3, "Done")) })
        // A refused end leaves the activity as it was.
        assertEquals(listOf("active" to snapshot(2, "Two")), engine.list().map { it.state to it.snapshot })

        val final = snapshot(3, "Done", 2.0).copy(timestamp = 1790000000000)
        val posts = port.posts
        val ended = engine.end(first.id, "immediate", final)
        assertEquals("ended" to final, ended.state to ended.snapshot)
        assertEquals("Done", ended.json().getJSONObject("snapshot").getJSONObject("values").getString("title"))
        // No end keeps a notification on Android: it is cancelled, not posted again with the final content.
        assertEquals(posts, port.posts)
        assertFalse(first.id in port.extras)
        val kept = LayoutRecord.fromJson(JSONArray(preferences.getString(LayoutPreferencesStore.LAYOUT_RECORDS, null)).getJSONObject(0))
        assertEquals("ended" to final, kept.state to kept.snapshot)
        // Ending again answers the ended record, whatever final content comes with it.
        assertEquals(tree(ended.json()), tree(engine.end(first.id, "immediate", snapshot(4, "Later")).json()))

        // The accepted content again ends the activity with it; no final content keeps the accepted snapshot.
        val second = engine.start(request)
        engine.update(second.id, snapshot(1, "One"))
        assertEquals(snapshot(1, "One"), engine.end(second.id, "default", snapshot(1, "One")).snapshot)
        assertEquals(request.snapshot, engine.end(engine.start(request).id, "immediate").snapshot)

        // A dismissed activity keeps no layout to check final content against, and ends with what it had.
        val dismissed = engine.start(request)
        port.extras = port.extras - dismissed.id
        assertEquals("dismissed", engine.list().first { it.id == dismissed.id }.state)
        val closed = engine.end(dismissed.id, "immediate", snapshot(5, "Done"))
        assertEquals("ended" to request.snapshot, closed.state to closed.snapshot)
    }

    @Test fun recordsReadBackFromStorageAndThePublicFormHidesTheLayout() {
        val port = FakeLayoutPort(); val engine = LayoutEngine(MemoryLayoutStore(), port)
        val record = engine.update(engine.start(request).id, snapshot(4, "Later", 2.5)).copy(state = "active", promotionRequested = true, promotionState = "promoted")
        assertEquals(record, LayoutRecord.fromJson(JSONObject(record.json(internal = true).toString())))
        val public = record.json()
        assertEquals(setOf("id", "activityKey", "schemaVersion", "snapshot", "backend", "state", "visibility", "degradedFeatures", "promotionRequested", "promotionState"), public.keys().asSequence().toSet())
        assertEquals(2, public.getInt("schemaVersion"))
        assertEquals("unknown", public.getString("visibility"))
        assertEquals("androidNotification", public.getString("backend"))
        val shown = public.getJSONObject("snapshot")
        assertEquals(setOf("revision", "values"), shown.keys().asSequence().toSet())
        assertEquals(4L, shown.getLong("revision"))
        assertEquals("Later" to 2.5, shown.getJSONObject("values").let { it.getString("title") to it.getDouble("n") })
        assertEquals(listOf("layout.symbol"), public.getJSONArray("degradedFeatures").let { array -> (0 until array.length()).map(array::getString) })
        val unpromoted = record.copy(promotionState = "notPromoted").json().getJSONArray("degradedFeatures")
        assertEquals("nativeLiveActivity", unpromoted.getString(0))
        val extra = record.extra()
        assertFalse(extra.has("origin"))
        assertEquals(LayoutNotificationExtra(record.id, record.snapshot, true), LayoutNotificationExtra.fromJson(JSONObject(extra.toString())))
        assertTrue(record.declares("stop") && !record.declares("other"))
    }
}
