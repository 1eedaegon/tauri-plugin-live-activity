package io.github.eedaegon.liveactivity

import org.json.JSONObject
import org.json.JSONTokener

/**
 * One UI's text extras for the Now Bar, sent when the host sets `android.samsungNowBar: true` in
 * the plugin configuration (see docs/android-integration.md). They make the Now Bar pill show the
 * body instead of the chip text. They do not put the app on Samsung's allow-list; only Samsung can.
 */
internal object SamsungNowBar {
    /** One UI 9 (Android 17). One UI 8.5 reportedly treats the style extra differently. */
    const val MIN_SDK = 37
    private const val PREFIX = "android.ongoingActivityNoti."

    fun extras(enabled: Boolean, sdk: Int, title: String, secondary: String?): Map<String, Any> {
        if (!enabled || sdk < MIN_SDK) return emptyMap()
        val extras = linkedMapOf<String, Any>("${PREFIX}style" to 1, "${PREFIX}primaryInfo" to title, "${PREFIX}nowbarPrimaryInfo" to title)
        if (secondary != null) {
            extras["${PREFIX}secondaryInfo"] = secondary
            extras["${PREFIX}nowbarSecondaryInfo"] = secondary
        }
        return extras
    }

    /** The pill's second line: the body, or else what the status chip shows. */
    fun secondary(spec: NotificationSpec): String? = spec.body?.takeIf { it.isNotEmpty() } ?: spec.shortCriticalText

    /** Keys read as CharSequence by One UI; the others are an Int and Strings. */
    fun isCharSequence(key: String) = key == "${PREFIX}primaryInfo" || key == "${PREFIX}secondaryInfo"
}

/** `plugins.live-activity` of the Tauri configuration, as Tauri hands it to the plugin. */
internal object PluginSettings {
    fun samsungNowBar(config: String?): Boolean {
        val root = try { config?.let { JSONTokener(it).nextValue() } } catch (_: Exception) { null }
        return ((root as? JSONObject)?.optJSONObject("android")?.opt("samsungNowBar")) == true
    }
}
