package io.github.eedaegon.liveactivity

import org.json.JSONObject
import org.json.JSONArray
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class InputTest {
    private fun snapshot() = JSONObject("""{"revision":0,"title":"Delivery","status":"Preparing","progress":0.5}""")
    private fun start() = JSONObject("""{"activityKey":"delivery:1","schemaVersion":1,"template":"progress","fallback":"notification"}""").put("snapshot", snapshot())
    private fun rejects(action: () -> Unit) {
        try { action(); fail("Expected rejection") } catch (_: ActivityFailure) {}
    }

    @Test fun matchesTheSharedRequestFixtures() {
        val fixtures = JSONArray(File(requireNotNull(System.getProperty("fixturePath", "tests/fixtures/requests.json"))).readText())
        for (index in 0 until fixtures.length()) {
            val fixture = fixtures.getJSONObject(index)
            val request = fixture.getJSONObject("request")
            val accepted = try {
                Input.keys(request, setOf("command", "input"))
                val input = request.getJSONObject("input")
                when (request.getString("command")) {
                    "start" -> Input.start(input)
                    "update" -> { Input.keys(input, setOf("id", "snapshot")); Input.id(input.get("id")); Input.snapshot(input.getJSONObject("snapshot")) }
                    "end" -> Input.end(input)
                    else -> throw ActivityFailure("INVALID_INPUT", "Unknown command")
                }
                true
            } catch (_: Exception) { false }
            assertEquals(fixture.getString("name"), fixture.getBoolean("valid"), accepted)
        }
    }

    @Test fun refusesMissingUnknownNullAndCoercedFields() {
        rejects { Input.start(start().put("secret", "unknown")) }
        rejects { Input.start(start().put("activityKey", JSONObject.NULL)) }
        rejects { Input.start(start().put("schemaVersion", "1")) }
        rejects { Input.start(start().put("activityKey", "../invalid")) }
        rejects { Input.start(start().put("schemaVersion", 0)) }
        rejects { Input.start(start().put("template", "other")) }
        rejects { Input.start(start().put("fallback", "automatic")) }
        rejects { Input.start(start().put("template", "timer")) }
        rejects { Input.snapshot(snapshot().put("title", " ")) }
        rejects { Input.snapshot(snapshot().put("title", 55)) }
        rejects { Input.snapshot(snapshot().put("title", "a".repeat(121))) }
        rejects { Input.id(45) }
        rejects { Input.id("") }
    }

    @Test fun validatesNumbersTimesAndCompleteSnapshots() {
        rejects { Input.snapshot(snapshot().put("revision", -1)) }
        rejects { Input.snapshot(snapshot().put("revision", 1.5)) }
        rejects { Input.snapshot(snapshot().put("revision", 9007199254740992L)) }
        rejects { Input.snapshot(snapshot().put("progress", "0.5")) }
        rejects { Input.snapshot(snapshot().put("progress", 1.1)) }
        rejects { Input.snapshot(snapshot().put("staleAt", -1)) }
        rejects { Input.snapshot(snapshot().put("staleAt", 8640000000000001L)) }
        rejects { Input.snapshot(snapshot().put("timer", JSONObject().put("startedAt", 1).put("endsAt", 2))) }
        val timer = snapshot().apply { remove("progress") }
        rejects { Input.snapshot(timer) }
        rejects { Input.snapshot(timer.put("timer", JSONObject().put("startedAt", 2).put("endsAt", 1))) }
        assertEquals(Timer(1, 2), Input.snapshot(timer.put("timer", JSONObject().put("startedAt", 1).put("endsAt", 2))).timer)
        assertEquals(0L, Input.snapshot(snapshot().put("staleAt", 0)).staleAt)
    }

    @Test fun persistenceRoundTripPreservesOriginAndUpdatedContent() {
        val original = Input.start(start())
        val record = ActivityRecord("handle", original, original.snapshot.copy(revision = 2, progress = 1.0), "active", true, "promoted")
        assertEquals(record, ActivityRecord.fromJson(record.json(internal = true)))
        assertFalse(record.json().has("origin"))
        assertEquals("unknown", record.json().getString("visibility"))
        assertEquals(0, record.json().getJSONArray("degradedFeatures").length())
    }

    @Test fun validatesEndPolicyShapeWithoutCoercion() {
        rejects { Input.end(JSONObject("""{"id":"id","policy":{"kind":"unknown"}}""")) }
        rejects { Input.end(JSONObject("""{"id":"id","policy":{"kind":"immediate","at":1}}""")) }
        assertEquals("after", Input.end(JSONObject("""{"id":"id","policy":{"kind":"after","at":1}}""")).second)
    }
}
