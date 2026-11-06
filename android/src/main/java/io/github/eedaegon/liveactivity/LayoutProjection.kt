package io.github.eedaegon.liveactivity

import java.math.BigDecimal
import kotlin.math.abs
import kotlin.math.roundToInt

internal data class ActionSpec(val actionId: String, val label: String)

/** A chronometer: counting down to `end`, or up from `start`. */
internal data class TimerSpec(val start: Long, val end: Long, val countsDown: Boolean)

/** What an Android notification shows of a layout at one set of values. */
internal data class NotificationSpec(
    val title: String?,
    val body: String?,
    /** 0..1. */
    val progress: Double?,
    val timer: TimerSpec?,
    val actions: List<ActionSpec>,
    /** `layout.<type>` once per node type that is shown on iOS and not here, then the ignored layout parts. */
    val ignored: List<String>,
) {
    /**
     * The status chip text. A timer has none, so the chip shows its chronometer; otherwise a
     * progress bar gives its percentage. Text alone gives none: no text node is short by contract.
     */
    val shortCriticalText: String? get() = if (timer == null && progress != null) "${(progress * 100).roundToInt()}%" else null
}

/**
 * Projects the lock screen tree onto a notification, in document order (`children` order, depth
 * first) with the conditions applied: the first text is the title, the second the body, the first
 * progress and timer drive the progress bar and the chronometer, and up to three buttons become
 * actions labelled with the first text inside them. Texts inside a button only label it.
 */
internal object LayoutProjection {
    const val MAX_ACTIONS = 3
    private val CONTAINERS = setOf("vstack", "hstack", "zstack")

    fun project(origin: LayoutStart, values: Map<String, Any>): NotificationSpec {
        val walk = Walk(values)
        walk.visit(origin.layout.getValue("lockScreen"))
        val parts = listOfNotNull(
            "layout.island".takeIf { "island" in origin.layout },
            "layout.styles".takeIf { origin.styles != null },
            "layout.background".takeIf { "background" in origin.layout },
            "layout.keyline".takeIf { "keyline" in origin.layout },
        )
        return NotificationSpec(walk.texts.getOrNull(0), walk.texts.getOrNull(1), walk.progress, walk.timer, walk.actions.toList(), walk.ignored.toList() + parts)
    }

    /** Every action id of the lock screen tree, whatever the conditions. */
    fun actionIds(layout: Map<String, Any>): Set<String> {
        val ids = mutableSetOf<String>()
        fun collect(raw: Any) {
            val node = raw.members()
            when (node["type"] as String) {
                "button" -> { ids += node["actionId"] as String; collect(node.getValue("child")) }
                in CONTAINERS -> node.getValue("children").items().forEach(::collect)
            }
        }
        collect(layout.getValue("lockScreen"))
        return ids
    }

    private class Walk(private val values: Map<String, Any>) {
        val texts = mutableListOf<String>()
        var progress: Double? = null
        var timer: TimerSpec? = null
        val actions = mutableListOf<ActionSpec>()
        val ignored = LinkedHashSet<String>()

        fun visit(raw: Any) {
            val node = raw.members()
            if (!shown(node)) return
            when (val type = node["type"] as String) {
                in CONTAINERS -> node.getValue("children").items().forEach(::visit)
                "text" -> if (texts.size < 2) texts += text(node) else ignored += "layout.$type"
                "progress" -> if (progress == null) progress = number(node["bind"]).coerceIn(0.0, 1.0) else ignored += "layout.$type"
                "timerText" -> if (timer == null) timer = timer(node) else ignored += "layout.$type"
                "button" -> button(node)
                else -> ignored += "layout.$type"
            }
        }

        private fun button(node: Map<String, Any>) {
            val inner = LinkedHashSet<String>()
            val label = label(node.getValue("child"), inner)
            if (label.isNullOrEmpty() || actions.size >= MAX_ACTIONS) {
                ignored += "layout.button"
                return
            }
            actions += ActionSpec(node["actionId"] as String, label)
            ignored += inner
        }

        /** The first shown text inside a button; the other shown nodes go to `inner`. */
        private fun label(child: Any, inner: MutableSet<String>): String? {
            var found: String? = null
            fun walk(raw: Any) {
                val node = raw.members()
                if (!shown(node)) return
                when (val type = node["type"] as String) {
                    in CONTAINERS -> node.getValue("children").items().forEach(::walk)
                    "text" -> if (found == null) found = text(node) else inner += "layout.$type"
                    else -> inner += "layout.$type"
                }
            }
            walk(child)
            return found
        }

        private fun shown(node: Map<String, Any>): Boolean {
            val condition = node["if"]?.let { truthy(values.getValue(it as String)) } ?: true
            val exception = node["unless"]?.let { truthy(values.getValue(it as String)) } ?: false
            return condition && !exception
        }

        private fun text(node: Map<String, Any>): String = node["value"] as? String ?: displayText(values.getValue(node["bind"] as String))
        private fun number(key: Any?): Double = values.getValue(key as String) as Double
        private fun timer(node: Map<String, Any>) =
            TimerSpec(number(node["start"]).toLong(), number(node["end"]).toLong(), node["countsDown"] as? Boolean ?: true)
    }
}

/** `true`, a number other than 0, a non-empty string. */
internal fun truthy(value: Any): Boolean = when (value) {
    is Boolean -> value
    is Double -> value != 0.0
    is String -> value.isNotEmpty()
    else -> false
}

/** A value as a text node shows it: numbers print as JavaScript's `String(number)` does. */
internal fun displayText(value: Any): String = when (value) {
    is String -> value
    is Boolean -> value.toString()
    is Double -> numberText(value)
    else -> value.toString()
}

private fun numberText(number: Double): String {
    if (number == 0.0) return "0"
    if (number % 1.0 == 0.0 && abs(number) < 1e21) return BigDecimal(number).toBigInteger().toString()
    val decimal = BigDecimal(number.toString()).stripTrailingZeros()
    if (abs(number) >= 1e-6) return decimal.toPlainString()
    val digits = decimal.unscaledValue().abs().toString()
    val mantissa = if (digits.length == 1) digits else digits.first() + "." + digits.drop(1)
    val exponent = digits.length - 1 - decimal.scale()
    return (if (number < 0) "-" else "") + mantissa + "e" + exponent
}
