package io.github.eedaegon.liveactivity

import org.json.JSONObject

internal object Input {
    /** The arguments of a command of the plugin's own: exactly the members [required], none of them null. */
    fun keys(json: JSONObject, required: Set<String>) {
        val actual = json.keys().asSequence().toSet()
        if (actual != required || actual.any { json.isNull(it) }) {
            throw ActivityFailure("INVALID_INPUT", "Invalid activity request.")
        }
    }
}
