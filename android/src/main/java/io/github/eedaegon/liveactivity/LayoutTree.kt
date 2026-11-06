package io.github.eedaegon.liveactivity

import org.json.JSONArray
import org.json.JSONObject

/**
 * A request of contract v2 as plain immutable values: `Map<String, Any>`, `List<Any>`, `String`,
 * `Double`, `Boolean` and [JsonNull]. Every number becomes a `Double`, so the integer `8` and the
 * `8.0` that Rust writes for an f64 compare equal, on Android's org.json and on the JVM's. A minus
 * zero becomes 0, as `JSON.stringify` writes it, so `-0.0` from Rust equals the stored `0`.
 */
internal object JsonNull

/** A valid request nests at most 20 arrays and objects; deeper input is refused unread. */
private const val MAX_NESTING = 32
private const val MAX_SAFE_INTEGER = 9007199254740991.0

internal fun invalidLayout(): Nothing = throw ActivityFailure("INVALID_INPUT", "Invalid layout request.")

internal fun tree(value: Any?, room: Int = MAX_NESTING): Any = when (value) {
    null -> JsonNull
    is JSONObject -> {
        if (room == 0) invalidLayout()
        val members = LinkedHashMap<String, Any>()
        value.keys().forEach { key -> members[scalars(key)] = tree(value.opt(key), room - 1) }
        members
    }
    is JSONArray -> {
        if (room == 0) invalidLayout()
        List(value.length()) { tree(value.opt(it), room - 1) }
    }
    is String -> scalars(value)
    is Boolean -> value
    // `-0.0 == 0.0`, so this maps minus zero to plus zero and keeps every other number.
    is Number -> value.toDouble().let { if (it == 0.0) 0.0 else it }
    else -> if (value == JSONObject.NULL) JsonNull else invalidLayout()
}

/** Text of Unicode scalar values only: a lone UTF-16 surrogate is refused. */
private fun scalars(text: String): String {
    var index = 0
    while (index < text.length) {
        val char = text[index]
        when {
            Character.isHighSurrogate(char) -> {
                if (index + 1 >= text.length || !Character.isLowSurrogate(text[index + 1])) invalidLayout()
                index += 2
            }
            Character.isLowSurrogate(char) -> invalidLayout()
            else -> index += 1
        }
    }
    return text
}

/** Back to org.json; a whole number in the safe integer range is written without a fraction. */
internal fun toJson(value: Any): Any = when (value) {
    is Map<*, *> -> JSONObject().also { target -> value.forEach { (key, member) -> target.put(key as String, toJson(member!!)) } }
    is List<*> -> JSONArray().also { target -> value.forEach { target.put(toJson(it!!)) } }
    is Double -> if (value % 1.0 == 0.0 && kotlin.math.abs(value) <= MAX_SAFE_INTEGER) value.toLong() else value
    else -> value
}

/** The payload weight of request contract v2. */
internal fun weigh(value: Any): Int = when (value) {
    is String -> utf8(value) + 2
    is Double -> 8
    is Boolean -> 5
    is List<*> -> 2 + value.sumOf { weigh(it!!) + 1 }
    is Map<*, *> -> 2 + value.entries.sumOf { (key, member) -> utf8(key as String) + 3 + weigh(member!!) + 1 }
    else -> 4
}

internal fun utf8(text: String): Int = text.toByteArray(Charsets.UTF_8).size

@Suppress("UNCHECKED_CAST")
internal fun Any?.members(): Map<String, Any> = this as? Map<String, Any> ?: invalidLayout()

@Suppress("UNCHECKED_CAST")
internal fun Any?.items(): List<Any> = this as? List<Any> ?: invalidLayout()

internal fun Any?.text(): String = this as? String ?: invalidLayout()
internal fun Any?.flag(): Boolean = this as? Boolean ?: invalidLayout()
internal fun Any?.number(): Double = (this as? Double)?.takeIf { it.isFinite() } ?: invalidLayout()

/** Exactly the required members and no others than the optional ones. */
internal fun Map<String, Any>.only(required: Set<String>, optional: Set<String> = emptySet()): Map<String, Any> {
    if (!keys.containsAll(required) || !(required + optional).containsAll(keys)) invalidLayout()
    return this
}

internal fun Any?.integer(maximum: Double): Long {
    val number = number()
    if (number % 1.0 != 0.0 || number < 0 || number > maximum) invalidLayout()
    return number.toLong()
}

internal fun Any?.within(minimum: Double, maximum: Double): Double = number().also { if (it < minimum || it > maximum) invalidLayout() }
internal fun Any?.oneOf(words: Set<String>): String = text().also { if (it !in words) invalidLayout() }
internal fun String.codePointLength(): Int = codePointCount(0, length)
