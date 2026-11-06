package io.github.eedaegon.liveactivity

/** The rules of request contract v2 that need the layout, the styles and the values together. */
internal object LayoutRules {
    const val MAX_WEIGHT = 3584
    const val MAX_NUMBER = 8640000000000000.0
    const val MAX_TIMESTAMP = 8640000000000000.0
    const val MAX_REVISION = 9007199254740991.0
    private const val MAX_DEPTH = 8
    private const val MAX_BUTTONS = 4

    private val NAME = Regex("[A-Za-z][A-Za-z0-9_]{0,31}")
    private val ACTIVITY_KEY = Regex("[A-Za-z0-9][A-Za-z0-9._:-]{0,127}")
    private val ACTION_ID = Regex("[A-Za-z0-9][A-Za-z0-9._:-]{0,63}")
    private val ASSET = Regex("[A-Za-z0-9][A-Za-z0-9._-]{0,63}")
    private val SYMBOL = Regex("[a-z0-9]+(\\.[a-z0-9]+)*")
    private val HEX = Regex("#(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})")

    private val HORIZONTAL = setOf("leading", "center", "trailing")
    private val VERTICAL = setOf("top", "center", "bottom", "firstTextBaseline")
    private val ALIGNMENT = setOf("center", "leading", "trailing", "top", "bottom", "topLeading", "topTrailing", "bottomLeading", "bottomTrailing")
    private val KINDS = setOf("linear", "circular")
    private val COLORS = setOf(
        "primary", "secondary", "accent", "red", "orange", "yellow", "green", "mint", "teal", "cyan", "blue",
        "indigo", "purple", "pink", "brown", "white", "black", "gray", "clear",
    )
    private val FONTS = setOf("largeTitle", "title", "title2", "title3", "headline", "subheadline", "body", "callout", "footnote", "caption", "caption2")
    private val WEIGHTS = setOf("ultraLight", "thin", "light", "regular", "medium", "semibold", "bold", "heavy", "black")
    private val STYLE_MEMBERS = setOf(
        "font", "size", "weight", "design", "monospacedDigit", "color", "lineLimit", "minimumScaleFactor", "alignment",
        "padding", "frame", "background", "cornerRadius", "opacity", "tint", "buttonStyle",
    )
    private val FRAME_LENGTHS = listOf("width", "height", "minWidth", "minHeight")
    private val FRAME_EXTENTS = listOf("maxWidth", "maxHeight")

    private class Shape(val required: Set<String>, val optional: Set<String> = emptySet())
    private val COMMON = setOf("style", "if", "unless")
    private val SHAPES = mapOf(
        "vstack" to Shape(setOf("children"), setOf("spacing", "alignment")),
        "hstack" to Shape(setOf("children"), setOf("spacing", "alignment")),
        "zstack" to Shape(setOf("children"), setOf("alignment")),
        "spacer" to Shape(emptySet(), setOf("minLength")),
        "divider" to Shape(emptySet()),
        "text" to Shape(emptySet(), setOf("value", "bind")),
        "symbol" to Shape(setOf("name"), setOf("rendering", "variableBind")),
        "image" to Shape(setOf("source"), setOf("resizable", "contentMode")),
        "path" to Shape(setOf("d", "box"), setOf("stroke")),
        "progress" to Shape(setOf("bind"), setOf("kind")),
        "gauge" to Shape(setOf("bind"), setOf("min", "max", "kind")),
        "timerText" to Shape(setOf("start", "end"), setOf("countsDown")),
        "button" to Shape(setOf("actionId", "child")),
    )

    fun isName(text: String) = NAME.matches(text)
    fun isActivityKey(text: String) = ACTIVITY_KEY.matches(text)

    fun tooLarge(): Nothing = throw ActivityFailure("PAYLOAD_TOO_LARGE", "Layout, styles and values exceed the payload weight limit.")

    /** The style table of a start: 1 to 24 styles under value-key-shaped tokens. */
    fun checkStyles(styles: Map<String, Any>) {
        if (styles.size !in 1..24) invalidLayout()
        styles.forEach { (token, style) -> if (!isName(token)) invalidLayout(); style(style) }
    }

    /** Every rule of the layout, including the references to `styles` and `values`. */
    fun checkLayout(layout: Map<String, Any>, styles: Map<String, Any>?, values: Map<String, Any>) = Scope(values, styles).layout(layout)

    /** An update: the keys and types accepted at start, the stored layout's rules again, then the weight. */
    fun checkReplacement(origin: LayoutStart, previous: Map<String, Any>, values: Map<String, Any>) {
        if (values.keys != previous.keys || values.any { (key, value) -> value.javaClass != previous.getValue(key).javaClass }) {
            throw ActivityFailure("INVALID_INPUT", "Values must keep the keys and types accepted at start.")
        }
        checkLayout(origin.layout, origin.styles, values)
        if (origin.documentWeight + weigh(values) > MAX_WEIGHT) tooLarge()
    }

    fun color(raw: Any) {
        when (raw) {
            is String -> if (raw !in COLORS && !HEX.matches(raw)) invalidLayout()
            is Map<*, *> -> {
                val pair = raw.members().only(setOf("light", "dark"))
                if (!HEX.matches(pair["light"].text()) || !HEX.matches(pair["dark"].text())) invalidLayout()
            }
            else -> invalidLayout()
        }
    }

    private fun style(raw: Any) {
        val style = raw.members().only(emptySet(), STYLE_MEMBERS)
        if (style.isEmpty() || ("font" in style && "size" in style)) invalidLayout()
        style["font"]?.oneOf(FONTS)
        style["size"]?.within(6.0, 96.0)
        style["weight"]?.oneOf(WEIGHTS)
        style["design"]?.oneOf(setOf("default", "rounded", "serif", "monospaced"))
        style["monospacedDigit"]?.flag()
        style["lineLimit"]?.let { if (it.integer(10.0) < 1) invalidLayout() }
        style["minimumScaleFactor"]?.within(0.1, 1.0)
        style["alignment"]?.oneOf(HORIZONTAL)
        style["padding"]?.let { padding -> if (padding is List<*>) edges(padding) else padding.within(0.0, 64.0) }
        style["frame"]?.let(::frame)
        style["cornerRadius"]?.within(0.0, 64.0)
        style["opacity"]?.within(0.0, 1.0)
        style["buttonStyle"]?.oneOf(setOf("automatic", "bordered", "borderedProminent", "plain"))
        listOf("color", "background", "tint").forEach { key -> style[key]?.let(::color) }
    }

    private fun edges(edges: List<*>) {
        if (edges.size != 4) invalidLayout()
        edges.forEach { it.within(0.0, 64.0) }
    }

    private fun frame(raw: Any) {
        val frame = raw.members().only(emptySet(), (FRAME_LENGTHS + FRAME_EXTENTS + "alignment").toSet())
        if (frame.isEmpty()) invalidLayout()
        FRAME_LENGTHS.forEach { frame[it]?.within(0.0, 1024.0) }
        FRAME_EXTENTS.forEach { key -> frame[key]?.let { if (it != "infinity") it.within(0.0, 1024.0) } }
        frame["alignment"]?.oneOf(ALIGNMENT)
    }

    /** What the nodes of one request may refer to, and the counts of the region being read. */
    private class Scope(private val values: Map<String, Any>, private val styles: Map<String, Any>?) {
        private var nodes = 0
        private var buttons = 0

        fun layout(layout: Map<String, Any>) {
            layout.only(setOf("lockScreen"), setOf("island", "background", "keyline"))
            layout["background"]?.let(::color)
            layout["keyline"]?.let(::color)
            region(layout["lockScreen"], 40, true)
            val island = layout["island"]?.members()?.only(emptySet(), setOf("expanded", "compactLeading", "compactTrailing", "minimal")) ?: return
            if (island.isEmpty()) invalidLayout()
            island["expanded"]?.let { part ->
                val expanded = part.members().only(emptySet(), setOf("leading", "trailing", "center", "bottom"))
                if (expanded.isEmpty()) invalidLayout()
                expanded.values.forEach { region(it, 12, true) }
            }
            listOf("compactLeading", "compactTrailing", "minimal").forEach { key -> island[key]?.let { region(it, 3, false) } }
        }

        private fun region(root: Any?, mostNodes: Int, buttonsAllowed: Boolean) {
            nodes = 0
            buttons = 0
            node(root, 1, buttonsAllowed)
            if (nodes > mostNodes || buttons > MAX_BUTTONS) invalidLayout()
        }

        /** `buttonsAllowed` is false in a region without buttons and inside a button. */
        private fun node(raw: Any?, depth: Int, buttonsAllowed: Boolean) {
            val node = raw.members()
            nodes += 1
            if (depth > MAX_DEPTH) invalidLayout()
            val type = node["type"].text()
            val shape = SHAPES[type] ?: invalidLayout()
            node.only(shape.required + "type", shape.optional + COMMON)
            node["style"]?.let { token -> if (styles?.containsKey(token.text()) != true) invalidLayout() }
            if ("if" in node && "unless" in node) invalidLayout()
            listOfNotNull(node["if"], node["unless"]).forEach { known(it) }
            when (type) {
                "vstack", "hstack" -> {
                    node["spacing"]?.within(0.0, 64.0)
                    node["alignment"]?.oneOf(if (type == "vstack") HORIZONTAL else VERTICAL)
                    children(node, depth, buttonsAllowed)
                }
                "zstack" -> {
                    node["alignment"]?.oneOf(ALIGNMENT)
                    children(node, depth, buttonsAllowed)
                }
                "button" -> {
                    buttons += 1
                    if (!buttonsAllowed || !ACTION_ID.matches(node["actionId"].text())) invalidLayout()
                    node(node["child"], depth + 1, false)
                }
                else -> leaf(type, node)
            }
        }

        private fun children(node: Map<String, Any>, depth: Int, buttonsAllowed: Boolean) {
            val children = node["children"].items()
            if (children.size !in 1..12) invalidLayout()
            children.forEach { node(it, depth + 1, buttonsAllowed) }
        }

        private fun leaf(type: String, node: Map<String, Any>) {
            when (type) {
                "spacer" -> node["minLength"]?.within(0.0, 256.0)
                "text" -> text(node)
                "symbol" -> {
                    val name = node["name"].text()
                    if (name.length > 64 || !SYMBOL.matches(name)) invalidLayout()
                    node["rendering"]?.oneOf(setOf("monochrome", "hierarchical", "palette", "multicolor"))
                    node["variableBind"]?.let { if (number(it) !in 0.0..1.0) invalidLayout() }
                }
                "image" -> {
                    if (!ASSET.matches(node["source"].members().only(setOf("asset"))["asset"].text())) invalidLayout()
                    node["resizable"]?.flag()
                    node["contentMode"]?.oneOf(setOf("fit", "fill"))
                }
                "path" -> path(node)
                "progress" -> { number(node["bind"]); node["kind"]?.oneOf(KINDS) }
                "gauge" -> {
                    number(node["bind"])
                    if ((node["min"]?.number() ?: 0.0) >= (node["max"]?.number() ?: 1.0)) invalidLayout()
                    node["kind"]?.oneOf(KINDS)
                }
                "timerText" -> {
                    if (time(node["end"]) <= time(node["start"])) invalidLayout()
                    node["countsDown"]?.flag()
                }
            }
        }

        private fun text(node: Map<String, Any>) {
            val value = node["value"]
            val bind = node["bind"]
            when {
                value != null && bind == null -> if (value.text().codePointLength() > 200) invalidLayout()
                value == null && bind != null -> known(bind)
                else -> invalidLayout()
            }
        }

        private fun path(node: Map<String, Any>) {
            val d = node["d"].text()
            if (utf8(d) > 512 || !LayoutPath.valid(d)) invalidLayout()
            val box = node["box"].items()
            if (box.size != 2) invalidLayout()
            box.forEach { it.within(1.0, 1024.0) }
            node["stroke"]?.within(0.5, 16.0)
        }

        private fun known(key: Any?): Any = values[key.text()] ?: invalidLayout()
        private fun number(key: Any?): Double = known(key) as? Double ?: invalidLayout()

        /** A time is an integer from 0 to the v1 maximum, in epoch milliseconds. */
        private fun time(key: Any?): Double = number(key).also { if (it % 1.0 != 0.0 || it < 0 || it > MAX_TIMESTAMP) invalidLayout() }
    }
}
