package io.github.eedaegon.liveactivity

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class LayoutProjectionTest {
    private fun start(lockScreen: String, values: String = "{}", extra: String = "") = LayoutInput.start(JSONObject(
        """{"activityKey":"a","schemaVersion":2,"fallback":"none","layout":{"lockScreen":$lockScreen$extra},"snapshot":{"revision":0,"values":$values}}""",
    ))

    private fun project(lockScreen: String, values: String = "{}") = start(lockScreen, values).let { LayoutProjection.project(it, it.snapshot.values) }

    private val session = """{"type":"vstack","children":[
        {"type":"hstack","children":[{"type":"symbol","name":"timer"},{"type":"text","bind":"title"},{"type":"spacer"},
            {"type":"timerText","start":"from","end":"to"}]},
        {"type":"progress","bind":"done"},
        {"type":"text","bind":"status","if":"live"},
        {"type":"text","value":"Third"},
        {"type":"progress","bind":"done"},
        {"type":"button","actionId":"stop","child":{"type":"hstack","children":[{"type":"symbol","name":"stop.fill"},{"type":"text","value":"Stop"}]}},
        {"type":"button","actionId":"pause","child":{"type":"text","bind":"pauseLabel"}},
        {"type":"button","actionId":"a","child":{"type":"text","value":"A"}},
        {"type":"button","actionId":"b","child":{"type":"text","value":"B"}}]}"""
    private val sessionValues = """{"title":"Focus","status":"Listening","live":true,"from":1790000000000,"to":1790000600000,"done":0.25,"pauseLabel":"Pause"}"""

    @Test fun walksTheLockScreenInDocumentOrder() {
        val origin = start(session, sessionValues, ""","island":{"minimal":{"type":"symbol","name":"timer"}},"background":"blue"""")
        val spec = LayoutProjection.project(origin, origin.snapshot.values)
        assertEquals("Focus", spec.title)
        assertEquals("Listening", spec.body)
        assertEquals(0.25, spec.progress!!, 0.0)
        assertEquals(TimerSpec(1790000000000, 1790000600000, countsDown = true), spec.timer)
        assertEquals(listOf(ActionSpec("stop", "Stop"), ActionSpec("pause", "Pause"), ActionSpec("a", "A")), spec.actions)
        assertEquals(listOf("layout.symbol", "layout.spacer", "layout.text", "layout.progress", "layout.button", "layout.island", "layout.background"), spec.ignored)
        // The chip shows the chronometer when there is a timer.
        assertNull(spec.shortCriticalText)
    }

    @Test fun conditionsHideNodesWithTheirSubtreeAndHiddenNodesAreNotReported() {
        val values = sessionValues.replace("\"live\":true", "\"live\":false")
        val spec = project(session, values)
        assertEquals("Third", spec.body)
        assertEquals(listOf("layout.symbol", "layout.spacer", "layout.progress", "layout.button"), spec.ignored)
        val falsy = """{"type":"vstack","children":[{"type":"text","value":"zero","if":"zero"},{"type":"text","value":"empty","if":"empty"},
            {"type":"text","value":"no","if":"no"},{"type":"symbol","name":"a","unless":"one"},{"type":"text","value":"shown","unless":"zero"},
            {"type":"text","value":"also","if":"word"}]}"""
        val shown = project(falsy, """{"zero":0,"empty":"","no":false,"one":1,"word":"0"}""")
        assertEquals("shown" to "also", shown.title to shown.body)
        assertEquals(emptyList<String>(), shown.ignored)
    }

    @Test fun boundValuesPrintAsJavaScriptPrintsThem() {
        assertEquals(listOf("3", "0.5", "-42.5", "1e-7", "true", "1790000000000", "8640000000000000", "0", ""),
            listOf(3.0, 0.5, -42.5, 1e-7, true, 1.79e12, 8.64e15, -0.0, "").map(::displayText))
        assertEquals(listOf("1.5e-7", "0.000001", "-2.5e-8"), listOf(1.5e-7, 1e-6, -2.5e-8).map(::displayText))
        val spec = project("""{"type":"vstack","children":[{"type":"text","bind":"n"},{"type":"text","bind":"f"}]}""", """{"n":12,"f":false}""")
        assertEquals("12" to "false", spec.title to spec.body)
    }

    @Test fun progressIsClampedAndGivesTheShortCriticalText() {
        assertEquals(1.0, project("""{"type":"progress","bind":"p"}""", """{"p":1.5}""").progress!!, 0.0)
        val low = project("""{"type":"progress","bind":"p"}""", """{"p":-0.2}""")
        assertEquals(0.0, low.progress!!, 0.0)
        assertEquals("0%", low.shortCriticalText)
        assertEquals("65%", project("""{"type":"progress","bind":"p"}""", """{"p":0.654}""").shortCriticalText)
        assertNull(project("""{"type":"text","value":"Plain"}""").shortCriticalText)
    }

    @Test fun aTimerCountingUpStartsAtItsStart() {
        val spec = project("""{"type":"timerText","start":"a","end":"b","countsDown":false}""", """{"a":1000,"b":2000}""")
        assertEquals(TimerSpec(1000, 2000, countsDown = false), spec.timer)
    }

    @Test fun buttonsNeedATextAndTheirTextsAreNotTheTitle() {
        val spec = project("""{"type":"vstack","children":[{"type":"button","actionId":"go","child":{"type":"text","value":"Go"}},
            {"type":"text","value":"Title"},{"type":"button","actionId":"icon","child":{"type":"symbol","name":"play.fill"}},
            {"type":"button","actionId":"hidden","child":{"type":"text","value":"Hidden","if":"off"}}]}""", """{"off":false}""")
        assertEquals("Title", spec.title)
        assertNull(spec.body)
        assertEquals(listOf(ActionSpec("go", "Go")), spec.actions)
        assertEquals(listOf("layout.button"), spec.ignored)
        assertNull(project("""{"type":"divider"}""").title)
    }

    @Test fun stylesAndTheIslandAreReportedOnce() {
        val origin = LayoutInput.start(JSONObject("""{"activityKey":"a","schemaVersion":2,"fallback":"none","styles":{"s":{"font":"body"}},
            "layout":{"lockScreen":{"type":"vstack","style":"s","children":[{"type":"image","source":{"asset":"logo"}},{"type":"image","source":{"asset":"logo"}},
            {"type":"gauge","bind":"g"},{"type":"path","d":"M0 0","box":[1,1]},{"type":"zstack","children":[{"type":"divider"}]}]},
            "island":{"compactLeading":{"type":"text","value":"x"}},"keyline":"red"},"snapshot":{"revision":0,"values":{"g":1}}}"""))
        val spec = LayoutProjection.project(origin, origin.snapshot.values)
        assertEquals(listOf("layout.image", "layout.gauge", "layout.path", "layout.divider", "layout.island", "layout.styles", "layout.keyline"), spec.ignored)
    }
}
