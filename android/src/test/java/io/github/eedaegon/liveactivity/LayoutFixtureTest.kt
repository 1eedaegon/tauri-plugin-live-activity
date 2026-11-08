package io.github.eedaegon.liveactivity

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/** Runs every case of tests/fixtures/layout-requests.json: verdict, error code and weight. */
class LayoutFixtureTest {
    private val fixtures = JSONObject(File(requireNotNull(System.getProperty("layoutFixturePath", "../tests/fixtures/layout-requests.json"))).readText())

    private sealed class Outcome {
        data class Accepted(val weight: Int?) : Outcome()
        data class Rejected(val code: String) : Outcome()
    }

    /** v2 commands must fail with an ActivityFailure only; anything else escapes and fails the test. */
    private fun run(command: String, input: Any?): Outcome = try {
        when (command) {
            "start_layout" -> Outcome.Accepted(LayoutInput.start(input).weight)
            "update_layout" -> Outcome.Accepted(LayoutInput.update(input).second.weight)
            // An end states the weight of its final content's values, and none without final content.
            "end_layout" -> Outcome.Accepted(LayoutInput.end(input).snapshot?.weight)
            "start", "update" -> v1(command, input)
            else -> Outcome.Rejected("INVALID_INPUT")
        }
    } catch (failure: ActivityFailure) { Outcome.Rejected(failure.code) }

    /** The v1 validator, as the v1 fixture test runs it: any failure is INVALID_INPUT. */
    private fun v1(command: String, input: Any?): Outcome = try {
        val body = input as JSONObject
        if (command == "start") Input.start(body)
        else { Input.keys(body, setOf("id", "snapshot")); Input.id(body.get("id")); Input.snapshot(body.getJSONObject("snapshot")) }
        Outcome.Accepted(null)
    } catch (_: Exception) { Outcome.Rejected("INVALID_INPUT") }

    private fun cases(kind: String): List<JSONObject> = fixtures.getJSONArray(kind).let { array -> (0 until array.length()).map(array::getJSONObject) }

    // TP-CONTRACT-4
    @Test fun everyValidCaseIsAcceptedWithItsWeight() {
        val valid = cases("valid")
        assertTrue(valid.size >= 100)
        val wrong = valid.mapNotNull { case ->
            val expected = if (case.has("weight")) case.getInt("weight") else null
            val outcome = run(case.getString("command"), case.get("input"))
            if (outcome == Outcome.Accepted(expected)) null else "${case.getString("name")}: $outcome, expected weight $expected"
        }
        assertEquals(wrong.joinToString("\n"), 0, wrong.size)
    }

    // TP-CONTRACT-4
    @Test fun everyInvalidCaseFailsWithItsCode() {
        val invalid = cases("invalid")
        assertTrue(invalid.size >= 100)
        val wrong = invalid.mapNotNull { case ->
            val outcome = run(case.getString("command"), case.opt("input"))
            if (outcome == Outcome.Rejected(case.getString("code"))) null else "${case.getString("name")}: $outcome"
        }
        assertEquals(wrong.joinToString("\n"), 0, wrong.size)
    }

    /**
     * New content after a start, as the engine checks an update or the final content of an end: the
     * request alone, then its values against the stored layout and styles.
     */
    private fun replace(start: Any?, content: () -> LayoutSnapshot): Outcome = try {
        val origin = LayoutInput.start(start)
        val snapshot = content()
        LayoutRules.checkReplacement(origin, origin.snapshot.values, snapshot.values)
        Outcome.Accepted(origin.documentWeight + snapshot.weight)
    } catch (failure: ActivityFailure) { Outcome.Rejected(failure.code) }

    /** The cases of a list of `start` and new content that `content` reads, which do not meet their verdict. */
    private fun mismatches(kind: String, content: (JSONObject) -> LayoutSnapshot): List<String> = cases(kind).mapNotNull { case ->
        val name = case.getString("name")
        val started = run("start_layout", case.get("start"))
        val expected = if (case.has("code")) Outcome.Rejected(case.getString("code")) else Outcome.Accepted(case.getInt("weight"))
        val outcome = replace(case.get("start")) { content(case) }
        when {
            started !is Outcome.Accepted -> "$name: the start is $started"
            outcome != expected -> "$name: $outcome, expected $expected"
            else -> null
        }
    }

    // TP-CONTRACT-4
    @Test fun everyUpdateCaseMeetsTheStoredLayoutAsExpected() {
        assertTrue(cases("updates").size >= 20)
        val wrong = mismatches("updates") { LayoutInput.update(it.get("update")).second }
        assertEquals(wrong.joinToString("\n"), 0, wrong.size)
    }

    // TP-CONTRACT-4
    @Test fun everyEndCaseMeetsTheStoredLayoutAsExpected() {
        assertTrue(cases("ends").size >= 4)
        val wrong = mismatches("ends") { case ->
            checkNotNull(LayoutInput.end(case.get("end")).snapshot) { "${case.getString("name")} has no final content" }
        }
        assertEquals(wrong.joinToString("\n"), 0, wrong.size)
    }

    // TP-CONTRACT-4
    @Test fun everyValidStartUpdateAndFinalContentStatesAWeight() {
        val missing = cases("valid").filter { case ->
            !case.has("weight") && (case.getString("command") != "end_layout" || case.getJSONObject("input").has("snapshot"))
        }
        assertEquals(emptyList<JSONObject>(), missing)
        assertTrue(cases("invalid").any { it.getString("code") == "PAYLOAD_TOO_LARGE" })
        assertTrue(JSONArray(cases("valid").map { it.getString("name") }).length() == cases("valid").map { it.getString("name") }.toSet().size)
        val names = listOf("valid", "invalid", "updates", "ends").flatMap { kind -> cases(kind).map { it.getString("name") } }
        assertEquals(names.size, names.toSet().size)
    }
}
