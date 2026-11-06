package io.github.eedaegon.liveactivity

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SamsungNowBarTest {
    @Test fun theOptionIsReadFromThePluginConfiguration() {
        assertTrue(PluginSettings.samsungNowBar("""{"receipts":"redacted","android":{"samsungNowBar":true}}"""))
        listOf(null, "null", "{}", """{"receipts":"full"}""", """{"android":{}}""", """{"android":{"samsungNowBar":false}}""",
            """{"android":{"samsungNowBar":"true"}}""", """{"android":true}""", "{", "[]").forEach {
            assertFalse(it, PluginSettings.samsungNowBar(it))
        }
    }

    @Test fun extrasCarryTheTitleAndBodyOnOneUi9Only() {
        val extras = SamsungNowBar.extras(enabled = true, sdk = 37, title = "Listening", secondary = "Hello there")
        assertEquals(mapOf(
            "android.ongoingActivityNoti.style" to 1,
            "android.ongoingActivityNoti.primaryInfo" to "Listening",
            "android.ongoingActivityNoti.secondaryInfo" to "Hello there",
            "android.ongoingActivityNoti.nowbarPrimaryInfo" to "Listening",
            "android.ongoingActivityNoti.nowbarSecondaryInfo" to "Hello there",
        ), extras)
        assertEquals(setOf("android.ongoingActivityNoti.style", "android.ongoingActivityNoti.primaryInfo", "android.ongoingActivityNoti.nowbarPrimaryInfo"),
            SamsungNowBar.extras(enabled = true, sdk = 38, title = "Listening", secondary = null).keys)
        assertEquals(emptyMap<String, Any>(), SamsungNowBar.extras(enabled = true, sdk = 36, title = "Listening", secondary = "x"))
        assertEquals(emptyMap<String, Any>(), SamsungNowBar.extras(enabled = false, sdk = 37, title = "Listening", secondary = "x"))
    }

    @Test fun theSecondLineIsTheBodyOrElseTheShortCriticalText() {
        assertEquals("Body", SamsungNowBar.secondary(NotificationSpec("T", "Body", 0.5, null, emptyList(), emptyList())))
        assertEquals("50%", SamsungNowBar.secondary(NotificationSpec("T", null, 0.5, null, emptyList(), emptyList())))
        assertEquals(null, SamsungNowBar.secondary(NotificationSpec("T", null, null, null, emptyList(), emptyList())))
    }
}
