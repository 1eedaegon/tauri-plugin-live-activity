package io.github.eedaegon.liveactivity

import android.content.Context
import org.json.JSONArray

/**
 * Layout records in the plugin's preferences file under their own key, so the v1 `records` key and
 * every earlier plugin version that reads it never meet a v2 record. A tombstone is written in its
 * small form ([LayoutRecord.retired]).
 */
internal class LayoutPreferencesStore(context: Context) : Store<LayoutRecord> {
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    override fun read(): List<LayoutRecord> {
        val raw = preferences.getString(LAYOUT_RECORDS, null) ?: return emptyList()
        LastLayoutRecords.of(raw)?.let { return it }
        val records = try {
            val array = JSONArray(raw)
            (0 until array.length()).map { LayoutRecord.fromJson(array.getJSONObject(it)) }
        } catch (_: Exception) {
            throw ActivityFailure("NATIVE_ERROR", "Stored activity metadata could not be read.")
        }
        LastLayoutRecords.remember(raw, records)
        return records
    }

    override fun write(records: List<LayoutRecord>) {
        val kept = records.map(LayoutRecord::retired)
        val json = kept.joinToString(",", "[", "]") { it.storedJson }
        if (!preferences.edit().putString(LAYOUT_RECORDS, json).commit()) {
            throw ActivityFailure("NATIVE_ERROR", "Activity metadata could not be saved.")
        }
        LastLayoutRecords.remember(json, kept)
    }

    companion object {
        const val LAYOUT_RECORDS = "layoutRecords"
    }
}

/**
 * The records of the text that a layout store of this process read or wrote last. The text is the
 * key: a store reads its own write back without parsing it again, and any other text is parsed.
 */
private object LastLayoutRecords {
    @Volatile private var last: Pair<String, List<LayoutRecord>>? = null

    fun of(raw: String): List<LayoutRecord>? = last?.takeIf { it.first == raw }?.second

    fun remember(raw: String, records: List<LayoutRecord>) { last = raw to records }
}
