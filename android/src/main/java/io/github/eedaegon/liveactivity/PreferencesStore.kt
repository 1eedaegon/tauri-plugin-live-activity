package io.github.eedaegon.liveactivity

import android.content.Context
import org.json.JSONArray

internal const val PREFERENCES = "io.github.eedaegon.liveactivity.v1"
internal class PreferencesStore(context: Context) : RecordStore {
    private val preferences = context.getSharedPreferences(PREFERENCES, Context.MODE_PRIVATE)

    override fun read(): List<ActivityRecord> {
        try {
            val array = JSONArray(preferences.getString("records", "[]"))
            return (0 until array.length()).map { ActivityRecord.fromJson(array.getJSONObject(it)) }
        } catch (_: Exception) {
            throw ActivityFailure("NATIVE_ERROR", "Stored activity metadata could not be read.")
        }
    }

    override fun write(records: List<ActivityRecord>) {
        val json = JSONArray(records.map { it.json(internal = true) }).toString()
        if (!preferences.edit().putString("records", json).commit()) {
            throw ActivityFailure("NATIVE_ERROR", "Activity metadata could not be saved.")
        }
    }
}
