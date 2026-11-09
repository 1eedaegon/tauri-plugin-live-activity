package io.github.eedaegon.liveactivity

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.File

/** The layout store as the plugin keeps it in its preferences file. */
class LayoutStoreTest {
    private val fixtures = JSONObject(File(requireNotNull(System.getProperty("layoutFixturePath", "../tests/fixtures/layout-requests.json"))).readText())
        .getJSONArray("valid")
    private fun fixture(name: String): JSONObject = (0 until fixtures.length()).map(fixtures::getJSONObject).first { it.getString("name") == name }.getJSONObject("input")
    private val session = fixture("starts a session layout with styles, an island, conditions and a button")
    private val heavy = fixture("accepts a start that weighs exactly 3584, most of it in the layout").put("fallback", "notification")

    private fun start(input: JSONObject, key: String) = LayoutInput.start(JSONObject(input.toString()).put("activityKey", key))
    private fun stored(preferences: MemoryPreferences) = JSONArray(preferences.getString(LayoutPreferencesStore.LAYOUT_RECORDS, null))

    private fun code(action: () -> Unit): String {
        try { action(); fail("Expected a failure") } catch (failure: ActivityFailure) { return failure.code }
        throw AssertionError()
    }

    @Test fun aTombstoneKeepsWhatItsRecordShowsButNotTheLayout() {
        val preferences = MemoryPreferences()
        val engine = LayoutEngine(LayoutPreferencesStore(PreferencesContext(preferences)), JsonLayoutPort())
        val started = engine.start(start(session, "app:session"))
        val ended = engine.end(started.id, "immediate")
        val kept = stored(preferences).getJSONObject(0)
        assertFalse(kept.has("origin"))
        assertFalse(kept.toString().contains("lockScreen"))
        // What a later process reads from disk.
        val later = LayoutRecord.fromJson(kept)
        assertEquals(tree(ended.json()), tree(later.json()))
        assertEquals(later, LayoutRecord.fromJson(JSONObject(later.json(internal = true).toString())))
        assertEquals(tree(ended.json()), tree(engine.end(started.id, "immediate").json()))
        assertEquals(tree(ended.json()), tree(engine.list().single().json()))
        assertEquals("NOT_FOUND", code { engine.update(started.id, started.snapshot.copy(revision = 1)) })
        // A late tap on its notification still names the key of a declared button only.
        assertEquals(ActionTap("session.pause", started.id, "app:session"), ActionTaps.resolve(listOf(later), started.id, "session.pause"))
        assertNull(ActionTaps.resolve(listOf(later), started.id, "other"))
    }

    @Test fun aStoreReadsItsOwnWritesWithoutParsingAndAnUpdateCommitsTwice() {
        val preferences = MemoryPreferences()
        val store = LayoutPreferencesStore(PreferencesContext(preferences))
        val engine = LayoutEngine(store, JsonLayoutPort())
        val record = engine.start(start(session, "app:session"))
        val read = store.read()
        assertSame(read, store.read())
        // The receivers make their own store over the same file.
        assertSame(read, LayoutPreferencesStore(PreferencesContext(preferences)).read())
        val commits = preferences.commits
        engine.update(record.id, record.snapshot.copy(revision = 1))
        // The write ahead of the post, then one write with the post confirmed and observed.
        assertEquals(2, preferences.commits - commits)
        // Text that no store wrote is parsed.
        preferences.edit().putString(LayoutPreferencesStore.LAYOUT_RECORDS, "[]").commit()
        assertEquals(emptyList<LayoutRecord>(), store.read())
    }

    @Test fun endedActivitiesStaySmallInAFullStore() {
        val preferences = MemoryPreferences()
        val engine = LayoutEngine(LayoutPreferencesStore(PreferencesContext(preferences)), JsonLayoutPort())
        repeat(128) { engine.end(engine.start(start(heavy, "ended:$it")).id, "immediate") }
        repeat(32) { engine.start(start(heavy, "live:$it")) }
        val records = stored(preferences).let { array -> (0 until array.length()).map(array::getJSONObject) }
        val (live, ended) = records.partition { it.getString("state") != "ended" }
        assertEquals(32 to 128, live.size to ended.size)
        val layout = heavy.getJSONObject("layout").toString().length
        assertTrue(live.all { it.toString().length > layout })
        assertTrue(ended.all { it.toString().length < 1024 })
    }

    @Test fun aStoredRecordWithoutItsStartMustBeATombstone() {
        val preferences = MemoryPreferences()
        val store = LayoutPreferencesStore(PreferencesContext(preferences))
        val engine = LayoutEngine(store, JsonLayoutPort())
        engine.end(engine.start(start(session, "app:session")).id, "immediate")
        val tombstone = stored(preferences).getJSONObject(0)
        for (broken in listOf(
            JSONObject(tombstone.toString()).put("state", "active"),
            JSONObject(tombstone.toString()).put("activityKey", " "),
            JSONObject(tombstone.toString()).apply { remove("retired") },
            JSONObject(tombstone.toString()).put("retired", JSONObject().put("ignored", JSONArray()).put("actionIds", JSONArray().put(1))),
        )) {
            preferences.edit().putString(LayoutPreferencesStore.LAYOUT_RECORDS, JSONArray().put(broken).toString()).commit()
            assertEquals(broken.toString(), "NATIVE_ERROR", code { store.read() })
        }
    }
}
