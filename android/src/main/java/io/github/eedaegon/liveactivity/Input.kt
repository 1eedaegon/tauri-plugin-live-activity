package io.github.eedaegon.liveactivity

import org.json.JSONObject

internal object Input {
    private fun invalid(): Nothing = throw ActivityFailure("INVALID_INPUT", "Invalid activity request.")

    fun keys(json: JSONObject, required: Set<String>, optional: Set<String> = emptySet()) {
        val actual = json.keys().asSequence().toSet()
        if (!actual.containsAll(required) || !((required + optional).containsAll(actual))) invalid()
        if (actual.any { json.isNull(it) }) invalid()
    }

    private fun text(value: Any, maximum: Int): String {
        if (value !is String || value.all(::isContractWhitespace) || value.codePointCount(0, value.length) > maximum) invalid()
        return value
    }

    private fun isContractWhitespace(character: Char): Boolean = character.code.let {
        it in 0x0009..0x000D || it in 0x2000..0x200A || it in setOf(
            0x0020, 0x00A0, 0x1680, 0x2028, 0x2029, 0x202F, 0x205F, 0x3000, 0xFEFF,
        )
    }

    fun id(value: Any): String = text(value, 256)

}
