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

    // TP-ANDROID-18
    @Test fun theSettingForExactAlarmsOpensOnlyWhereThePersonCanAllowTheApp() {
        val either = listOf(true, false)
        // Before Android 12 an exact alarm needs no permission, so there is nothing to allow.
        for (sdk in listOf(26, 30)) for (allowed in either) for (declared in either) for (onScreen in either) {
            val setting = exactAlarmSetting(sdk, allowed, declared, onScreen)
            assertEquals("$sdk $allowed $declared $onScreen", ExactAlarmSetting.NothingToAllow, setting)
        }
        for (sdk in listOf(31, 33, 34, 37)) {
            // An app that may set exact alarms has nothing to allow either, whether the setting lists it or, as
            // with USE_EXACT_ALARM, does not: all that the person could do there is take the permission back,
            // which stops the app.
            for (declared in either) for (onScreen in either) {
                val setting = exactAlarmSetting(sdk, allowed = true, declared = declared, onScreen = onScreen)
                assertEquals("$sdk $declared $onScreen", ExactAlarmSetting.NothingToAllow, setting)
            }
            // The setting lists the apps whose manifest asks for the permission: one that does not has to declare
            // it first, wherever the app is.
            for (onScreen in either) {
                val setting = exactAlarmSetting(sdk, allowed = false, declared = false, onScreen = onScreen)
                assertEquals("$sdk $onScreen", ExactAlarmSetting.NotDeclared, setting)
            }
            // Android opens another screen only for an app that is on screen.
            assertEquals("$sdk", ExactAlarmSetting.NotOnScreen, exactAlarmSetting(sdk, allowed = false, declared = true, onScreen = false))
            assertEquals("$sdk", ExactAlarmSetting.Open, exactAlarmSetting(sdk, allowed = false, declared = true, onScreen = true))
        }
    }

    // TP-ANDROID-18
    @Test fun callsThatComeWhileTheSettingIsOpenWaitWithTheFirstAndAreAnsweredTogether() {
        val visit = SettingVisit<String>()
        // No visit is open: a call does not wait, and is the one that opens the setting.
        assertEquals(false, visit.joinIfOpen("first"))
        assertEquals(true, visit.join("first"))
        // One that comes while the setting is open waits with it, whatever else would be said of it, and opens nothing.
        assertEquals(true, visit.joinIfOpen("second"))
        assertEquals(false, visit.join("third"))
        // The person is back: every call that waited is answered, once.
        assertEquals(listOf("first", "second", "third"), visit.end())
        assertEquals(emptyList<String>(), visit.end())
        // The next call finds no visit open, and opens the setting again.
        assertEquals(false, visit.joinIfOpen("fourth"))
        assertEquals(true, visit.join("fourth"))
        assertEquals(listOf("fourth"), visit.end())
    }

    // TP-ANDROID-18
    @Test fun callsFromSeveralThreadsOpenTheSettingOnce() {
        val visit = SettingVisit<Int>()
        val opened = java.util.concurrent.atomic.AtomicInteger()
        val threads = (1..16).map { call -> Thread { if (!visit.joinIfOpen(call) && visit.join(call)) opened.incrementAndGet() } }
        threads.forEach(Thread::start)
        threads.forEach(Thread::join)
        assertEquals(1, opened.get())
        assertEquals((1..16).toList(), visit.end().sorted())
    }

    // TP-ANDROID-18
    @Test fun whetherExactAlarmsAreAllowedIsWhatLiveupdatesAdapterObserves() {
        /** The adapter's `capabilities` with a presentation that says [exactStart], or says nothing of it for null. */
        fun saying(exactStart: Any?) = observed(true, true)
            .put("presentation", JSONObject().put("scheduledStart", true).put("exactStart", exactStart))
        assertEquals(true, exactAlarmsAllowed(saying(true)))
        assertEquals(false, exactAlarmsAllowed(saying(false)))
        // A reply without the member is a failure of the native side, never a guess.
        for (reply in listOf(saying("yes"), saying(null), observed(true, true), observed(true, true).put("presentation", "none"))) {
            assertEquals("$reply", "NATIVE_ERROR", assertThrows(ActivityFailure::class.java) { exactAlarmsAllowed(reply) }.code)
        }
    }
}
