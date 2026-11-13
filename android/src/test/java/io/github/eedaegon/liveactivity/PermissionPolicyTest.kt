package io.github.eedaegon.liveactivity

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class PermissionPolicyTest {
    // TP-ANDROID-13
    @Test fun cancelledPermissionDialogRemainsPromptable() {
        assertEquals("prompt", notificationPermissionState(37, false, false, "prompt"))
        // Tauri caches DENIED even when the Android dialog was cancelled with no choice.
        assertEquals("unknown", notificationPermissionState(37, false, false, "denied"))
    }

    // TP-ANDROID-13
    @Test fun firstDenialAllowsExplicitRetryButPermanentDenialRequiresSettings() {
        assertEquals("prompt", notificationPermissionState(33, false, false, "prompt-with-rationale"))
        assertEquals("unknown", notificationPermissionState(33, false, false, "denied"))
        assertEquals("prompt", notificationPermissionState(33, false, false, "denied", shouldShowRationale = true, observedDenial = true))
        assertEquals("settingsRequired", notificationPermissionState(33, false, false, "denied", observedDenial = true))
        assertEquals("granted", notificationPermissionState(33, true, true, "denied", observedDenial = true))
    }

    // TP-ANDROID-13
    @Test fun blockedChannelRequiresSettingsEvenWithRuntimePermission() {
        assertEquals("settingsRequired", notificationPermissionState(37, false, true, "granted"))
        assertEquals("settingsRequired", notificationPermissionState(31, false, true, null))
        assertEquals("granted", notificationPermissionState(24, true, true, null))
    }

    // TP-ANDROID-13
    @Test fun theDialogShowsOnlyWhileAndroidCanStillAsk() {
        assertEquals(
            listOf("prompt", "unknown"),
            listOf("granted", "prompt", "settingsRequired", "unknown", "denied", "notApplicable").filter(::dialogCanAsk),
        )
    }

    /** What liveupdate's adapter answers to `capabilities`, of which the permissions read the two promotion members. */
    private fun observed(supported: Boolean, promotionEnabled: Boolean) = JSONObject()
        .put("supported", supported)
        .put("notificationsEnabled", true)
        .put("promotionEnabled", promotionEnabled)

    // TP-ANDROID-13
    @Test fun aReplyWithoutTheSettingsIsANativeFailure() {
        val settings = observedSettings(
            """{"status":"ok","data":{"supported":true,"notificationsEnabled":false,"promotionEnabled":false,"presentation":{}}}""",
        )
        assertEquals(false, settings.getBoolean("notificationsEnabled"))
        for (reply in listOf(
            """{"status":"error","error":{"code":"NATIVE_ERROR","message":"The Android live update adapter failed."}}""",
            """{"status":"ok","data":{"supported":true,"notificationsEnabled":true}}""",
            """{"status":"ok","data":{"supported":"yes","notificationsEnabled":true,"promotionEnabled":true}}""",
            "not json",
        )) {
            assertEquals("NATIVE_ERROR", assertThrows(reply, ActivityFailure::class.java) { observedSettings(reply) }.code)
        }
    }

    // TP-ANDROID-13
    @Test fun promotionFollowsWhatLiveupdatesAdapterObserves() {
        // Below Android 16 nothing is promoted, whatever the settings say.
        assertEquals("notApplicable", permissionsOf(observed(false, false), "granted").getString("promotion"))
        assertEquals("notApplicable", permissionsOf(observed(false, true), "granted").getString("promotion"))
        assertEquals("granted", permissionsOf(observed(true, true), "granted").getString("promotion"))
        // Only the person can allow promotion, in the settings: there is no dialog to show.
        assertEquals("settingsRequired", permissionsOf(observed(true, false), "granted").getString("promotion"))
    }

    // TP-ANDROID-13, TP-PUSH-5
    @Test fun permissionsCarryTheNotificationStateAndNothingOfIos() {
        for (state in listOf("granted", "prompt", "settingsRequired", "unknown")) {
            val permissions = permissionsOf(observed(true, true), state)
            assertEquals(state, permissions.getString("notifications"))
            assertEquals("notApplicable", permissions.getString("liveActivities"))
            assertEquals("notApplicable", permissions.getString("frequentPushes"))
            assertEquals(
                setOf("notifications", "liveActivities", "promotion", "frequentPushes"),
                permissions.keys().asSequence().toSet(),
            )
        }
    }
}
