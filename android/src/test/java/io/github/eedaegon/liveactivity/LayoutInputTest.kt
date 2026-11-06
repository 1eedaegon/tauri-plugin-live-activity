package io.github.eedaegon.liveactivity

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

class LayoutInputTest {
    private val layout = """{"lockScreen":{"type":"vstack","spacing":8,"children":[
        {"type":"text","bind":"title","style":"title"},
        {"type":"timerText","start":"from","end":"to"},
        {"type":"symbol","name":"waveform","variableBind":"level"},
        {"type":"path","d":"M0 0L24 24","box":[24,24]}]}}"""
    private val values = """{"title":"Focus","from":1790000000000,"to":1790000600000,"level":0.5,"live":true}"""
    private fun start(values: String = this.values) = JSONObject("""{"activityKey":"fremen:session","schemaVersion":2,"fallback":"notification",
        "layout":$layout,"styles":{"title":{"font":"headline","padding":4}},"snapshot":{"revision":0,"values":$values}}""")

    private fun code(action: () -> Unit): String {
        try { action(); fail("Expected a failure") } catch (failure: ActivityFailure) { return failure.code }
        throw AssertionError()
    }

    @Test fun readsTheFloatSpellingThatRustSendsAsTheSameRequest() {
        // serde_json writes every f64 with a fraction: 8.0, 24.0, 1790000000000.0.
        val text = start().toString().replace("\"spacing\":8", "\"spacing\":8.0").replace("[24,24]", "[24.0,24.0]")
            .replace("1790000000000,", "1790000000000.0,").replace("\"padding\":4", "\"padding\":4.0")
        assertTrue(text.contains("\"spacing\":8.0") && text.contains("[24.0,24.0]") && text.contains("1790000000000.0"))
        val rust = JSONObject(text)
        assertFalse(rust.getJSONObject("layout").getJSONObject("lockScreen").get("spacing") is Int)
        assertEquals(LayoutInput.start(start()), LayoutInput.start(rust))
    }

    @Test fun aStoredStartReadsBackAsTheSameRequest() {
        val original = LayoutInput.start(start().put("android", JSONObject().put("visibility", "public")))
        assertEquals(original, LayoutInput.start(JSONObject(original.json().toString())))
        assertEquals("public", original.visibility)
        assertEquals(2, original.json().getInt("schemaVersion"))
        assertEquals(1790000000000L, original.json().getJSONObject("snapshot").getJSONObject("values").getLong("from"))
    }

    @Test fun rejectsLoneSurrogatesInValuesTextsAndKeys() {
        assertEquals("INVALID_INPUT", code { LayoutInput.start(start("""{"title":"\ud800","from":1,"to":2,"level":0}""")) })
        val literal = start().toString().replace("\"bind\":\"title\"", "\"value\":\"a\\udc00b\"")
        assertEquals("INVALID_INPUT", code { LayoutInput.start(JSONObject(literal)) })
        val key = JSONObject("""{"id":"x","snapshot":{"revision":1,"values":{"a\udbff":1}}}""")
        assertEquals("INVALID_INPUT", code { LayoutInput.update(key) })
        // A surrogate pair is one code point and stays valid.
        LayoutInput.start(start("""{"title":"🎙","from":1,"to":2,"level":0}"""))
    }

    @Test fun stopsAtDeeplyNestedInputWithoutReadingAll() {
        var nested: Any = JSONArray()
        repeat(100_000) { nested = JSONArray().put(nested) }
        assertEquals("INVALID_INPUT", code { LayoutInput.start(start().put("extra", nested)) })
        assertEquals("INVALID_INPUT", code { LayoutInput.update(JSONObject().put("id", "x").put("snapshot", nested)) })
    }

    @Test fun messagesAreConstantAndNeverRepeatInput() {
        val secret = "secret-token-123"
        val long = secret.repeat(62).take(1000)
        val failures = listOf(
            { LayoutInput.start(start("""{"title":"$secret","unused":[1]}""")) },
            { LayoutInput.start(start().put(secret, 1)) },
            { LayoutInput.update(JSONObject().put("id", secret).put("snapshot", JSONObject().put("revision", 0).put("values", JSONObject("""{"a":"$long","b":"$long","c":"$long","d":"$long"}""")))) },
        ).map { action -> try { action(); null } catch (failure: ActivityFailure) { failure } }
        assertEquals(listOf("INVALID_INPUT", "INVALID_INPUT", "PAYLOAD_TOO_LARGE"), failures.map { it?.code })
        assertFalse(failures.any { it!!.message!!.contains(secret) })
    }

    @Test fun anUpdateMustKeepTheKeysAndTypesAndTheRulesOfTheStoredLayout() {
        val origin = LayoutInput.start(start())
        fun replace(values: String) = LayoutRules.checkReplacement(origin, origin.snapshot.values, LayoutInput.snapshot(JSONObject("""{"revision":1,"values":$values}""")).values)
        replace("""{"title":"Break","from":1790000000000,"to":1790000900000,"level":1,"live":false}""")
        assertEquals("INVALID_INPUT", code { replace("""{"title":"Break","from":1,"to":2,"level":1}""") })
        assertEquals("INVALID_INPUT", code { replace("""{"title":"Break","from":1,"to":2,"level":1,"live":false,"more":1}""") })
        assertEquals("INVALID_INPUT", code { replace("""{"title":7,"from":1,"to":2,"level":1,"live":false}""") })
        assertEquals("INVALID_INPUT", code { replace("""{"title":"a","from":"1","to":2,"level":1,"live":false}""") })
        assertEquals("INVALID_INPUT", code { replace("""{"title":"a","from":5,"to":5,"level":1,"live":false}""") })
        assertEquals("INVALID_INPUT", code { replace("""{"title":"a","from":1.5,"to":5,"level":1,"live":false}""") })
        assertEquals("INVALID_INPUT", code { replace("""{"title":"a","from":1,"to":5,"level":1.5,"live":false}""") })
        // Values of 3430 pass alone; with the stored layout (243) and no styles (2) they weigh 3675.
        val wide = LayoutInput.start(JSONObject("""{"activityKey":"a","schemaVersion":2,"fallback":"none","layout":{"lockScreen":{"type":"text","value":"${"x".repeat(200)}"}},
            "snapshot":{"revision":0,"values":{"a":"","b":"","c":"","d":""}}}"""))
        val y = "y".repeat(1000)
        val heavy = LayoutInput.snapshot(JSONObject("""{"revision":1,"values":{"a":"$y","b":"$y","c":"$y","d":"${"y".repeat(400)}"}}"""))
        assertEquals(3430, heavy.weight)
        assertEquals(245, wide.documentWeight)
        assertEquals("PAYLOAD_TOO_LARGE", code { LayoutRules.checkReplacement(wide, wide.snapshot.values, heavy.values) })
    }

    @Test fun endTakesTheV1PolicyShapes() {
        assertEquals("handle" to "immediate", LayoutInput.end(JSONObject("""{"id":"handle","policy":{"kind":"immediate"}}""")))
        assertEquals("handle" to "after", LayoutInput.end(JSONObject("""{"id":"handle","policy":{"kind":"after","at":0}}""")))
        assertEquals("INVALID_INPUT", code { LayoutInput.end(JSONObject("""{"id":"handle","policy":{"kind":5}}""")) })
        assertEquals("INVALID_INPUT", code { LayoutInput.end("text") })
    }

    @Test fun weightsFollowTheContractExample() {
        val start = LayoutInput.start(JSONObject("""{"activityKey":"a","schemaVersion":2,"fallback":"none","layout":{"lockScreen":{"type":"text","value":"Hello"}},"snapshot":{"revision":0,"values":{}}}"""))
        assertEquals(52, start.weight)
        assertEquals(2, start.snapshot.weight)
        assertTrue(LayoutInput.start(start()).weight > LayoutInput.start(start()).snapshot.weight)
    }
}
