package io.github.eedaegon.liveactivity

import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject

/** SharedPreferences in memory. A commit counts and keeps the very string that was put. */
internal class MemoryPreferences : SharedPreferences {
    var values: Map<String, Any?> = emptyMap()
    var commits = 0

    override fun getAll(): Map<String, *> = values
    override fun getString(key: String, defValue: String?): String? = values[key] as? String ?: defValue
    override fun getStringSet(key: String, defValues: MutableSet<String>?): MutableSet<String>? = defValues
    override fun getInt(key: String, defValue: Int): Int = values[key] as? Int ?: defValue
    override fun getLong(key: String, defValue: Long): Long = values[key] as? Long ?: defValue
    override fun getFloat(key: String, defValue: Float): Float = values[key] as? Float ?: defValue
    override fun getBoolean(key: String, defValue: Boolean): Boolean = values[key] as? Boolean ?: defValue
    override fun contains(key: String): Boolean = key in values
    override fun edit(): SharedPreferences.Editor = Editor()
    override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit
    override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit

    private inner class Editor : SharedPreferences.Editor {
        private var changes: Map<String, Any?> = emptyMap()
        private var cleared = false
        private fun put(key: String, value: Any?): SharedPreferences.Editor { changes = changes + (key to value); return this }
        override fun putString(key: String, value: String?) = put(key, value)
        override fun putStringSet(key: String, values: MutableSet<String>?) = put(key, values)
        override fun putInt(key: String, value: Int) = put(key, value)
        override fun putLong(key: String, value: Long) = put(key, value)
        override fun putFloat(key: String, value: Float) = put(key, value)
        override fun putBoolean(key: String, value: Boolean) = put(key, value)
        override fun remove(key: String) = put(key, null)
        override fun clear(): SharedPreferences.Editor { cleared = true; return this }
        override fun commit(): Boolean {
            commits += 1
            values = (if (cleared) emptyMap() else values) + changes
            return true
        }
        override fun apply() { commit() }
    }
}

/** A context that only hands out one preferences file, as the plugin's stores and receivers use it. */
internal class PreferencesContext(private val preferences: SharedPreferences) : ContextWrapper(null) {
    override fun getApplicationContext(): Context = this
    override fun getSharedPreferences(name: String?, mode: Int): SharedPreferences = preferences
}

/** An intent with an action and string extras; the JVM's android.jar keeps neither. */
internal class TestIntent(private val name: String, private val strings: Map<String, String>) : Intent() {
    override fun getAction(): String = name
    override fun getStringExtra(name: String?): String? = strings[name]
}

/** Keeps JSON as LayoutPreferencesStore does, so every read parses what was written. */
internal class JsonLayoutStore : Store<LayoutRecord> {
    var json = "[]"
    var writes = 0
    override fun read(): List<LayoutRecord> = JSONArray(json).let { array -> (0 until array.length()).map { LayoutRecord.fromJson(array.getJSONObject(it)) } }
    override fun write(records: List<LayoutRecord>) { writes += 1; json = JSONArray(records.map { it.json(internal = true) }).toString() }
}

/** Shows a posted notification at once and reads its snapshot back from the extra, as LayoutNotifications does. */
internal class JsonLayoutPort : Port<LayoutRecord, LayoutSnapshot> {
    var extras: Map<String, String> = emptyMap()
    var posts = 0
    override fun notificationsAllowed() = true
    override fun promotionAllowed() = false
    override fun observed() = extras.mapValues { (_, raw) ->
        val extra = LayoutNotificationExtra.fromJson(JSONObject(raw))
        Observation(extra.snapshot, "active", extra.promotionRequested, "notApplicable")
    }
    override fun post(record: LayoutRecord) { posts += 1; extras = extras + (record.id to record.extra().toString()) }
    override fun cancel(id: String) { extras = extras - id }
}
