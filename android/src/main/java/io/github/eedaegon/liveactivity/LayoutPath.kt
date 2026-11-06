package io.github.eedaegon.liveactivity

/**
 * Path data as request contract v2 defines it: segments of one command letter of `M L H V C S Q T Z`
 * (either case) and its numbers, the first a moveto, no arcs. It is not an SVG parser on purpose.
 */
internal object LayoutPath {
    private val arity = mapOf('M' to 2, 'L' to 2, 'T' to 2, 'H' to 1, 'V' to 1, 'C' to 6, 'S' to 4, 'Q' to 4, 'Z' to 0)

    fun valid(d: String): Boolean {
        var at = 0
        while (at < d.length) {
            val first = at == 0
            at = gap(d, at)
            // ASCII only: `uppercaseChar` would also turn the long s (U+017F) into `S`.
            val command = d.getOrNull(at)?.let { if (it in 'a'..'z') it.uppercaseChar() else it }
            val size = arity[command] ?: return false
            var count = 0
            var next = gap(d, at + 1)
            at = next
            while (true) {
                val end = number(d, next) ?: break
                count += 1
                at = end
                next = gap(d, at)
                if (d.getOrNull(next) == ',') next = gap(d, next + 1)
            }
            at = gap(d, at)
            val complete = if (size == 0) count == 0 else count > 0 && count % size == 0
            if (!complete || (first && command != 'M')) return false
        }
        return at > 0
    }

    private fun run(d: String, at: Int, accept: (Char) -> Boolean): Int {
        var end = at
        while (end < d.length && accept(d[end])) end += 1
        return end - at
    }

    /** Skips spaces, tabs and line breaks. */
    private fun gap(d: String, at: Int) = at + run(d, at) { it == ' ' || it == '\t' || it == '\r' || it == '\n' }

    private fun digits(d: String, at: Int) = run(d, at) { it in '0'..'9' }
    private fun sign(d: String, at: Int) = at + if (d.getOrNull(at) == '+' || d.getOrNull(at) == '-') 1 else 0

    /** The end of the number at `at`: `[+-]?(\d*\.)?\d+([eE][+-]?\d+)?`. */
    private fun number(d: String, at: Int): Int? {
        val whole = sign(d, at)
        var end = whole + digits(d, whole)
        if (d.getOrNull(end) == '.' && digits(d, end + 1) > 0) end += 1 + digits(d, end + 1)
        else if (end == whole) return null
        if (d.getOrNull(end) == 'e' || d.getOrNull(end) == 'E') {
            val exponent = sign(d, end + 1)
            if (digits(d, exponent) > 0) end = exponent + digits(d, exponent)
        }
        return end
    }
}
