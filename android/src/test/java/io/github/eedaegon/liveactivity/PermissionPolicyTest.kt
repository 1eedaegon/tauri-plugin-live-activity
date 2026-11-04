package io.github.eedaegon.liveactivity

import org.junit.Assert.assertEquals
import org.junit.Test

class PermissionPolicyTest {
    @Test fun cancelledPermissionDialogRemainsPromptable() {
        assertEquals("prompt", notificationPermissionState(37, false, false, "prompt"))
        // Tauri caches DENIED even when the Android dialog was cancelled with no choice.
        assertEquals("unknown", notificationPermissionState(37, false, false, "denied"))
    }

    @Test fun firstDenialAllowsExplicitRetryButPermanentDenialRequiresSettings() {
        assertEquals("prompt", notificationPermissionState(33, false, false, "prompt-with-rationale"))
        assertEquals("unknown", notificationPermissionState(33, false, false, "denied"))
        assertEquals("prompt", notificationPermissionState(33, false, false, "denied", shouldShowRationale = true, observedDenial = true))
        assertEquals("settingsRequired", notificationPermissionState(33, false, false, "denied", observedDenial = true))
        assertEquals("granted", notificationPermissionState(33, true, true, "denied", observedDenial = true))
    }

    @Test fun blockedChannelRequiresSettingsEvenWithRuntimePermission() {
        assertEquals("settingsRequired", notificationPermissionState(37, false, true, "granted"))
        assertEquals("settingsRequired", notificationPermissionState(31, false, true, null))
        assertEquals("granted", notificationPermissionState(24, true, true, null))
    }
}
