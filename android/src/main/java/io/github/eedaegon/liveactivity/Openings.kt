package io.github.eedaegon.liveactivity

import android.app.Activity
import android.app.Application
import android.content.ContentProvider
import android.content.ContentValues
import android.content.Intent
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.core.util.Consumer
import io.github.eedaegon.liveupdate.LiveUpdateEvents

/**
 * Watches the app's activities from the start of the process, for the intents that open the app.
 *
 * liveupdate stores an opening when an activity passes it the intent it was created or brought forward for. The
 * plugin itself comes too late for that: Tauri loads it once its Rust has started, and Android may deliver an
 * intent before then, as it does when a notification brings back an app whose process it had ended. Android creates
 * a provider before any activity of the app, so this one registers [OpeningIntents] there. It holds no data.
 */
class OpeningsProvider : ContentProvider() {
    override fun onCreate(): Boolean {
        (context?.applicationContext as? Application)?.registerActivityLifecycleCallbacks(OpeningIntents)
        return true
    }

    override fun query(
        uri: Uri,
        projection: Array<out String>?,
        selection: String?,
        selectionArgs: Array<out String>?,
        sortOrder: String?,
    ): Cursor? = null

    override fun getType(uri: Uri): String? = null

    override fun insert(uri: Uri, values: ContentValues?): Uri? = null

    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0

    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}

/**
 * Hands liveupdate the intent each activity is created for and every intent that brings it forward. liveupdate
 * stores an opening when one of its notifications sent the intent, and takes its marks off the intent it is handed.
 * Android keeps its own copy of an activity's first intent, marks and all, and hands that copy out again later; the
 * two cases it tells apart are left out here.
 */
internal object OpeningIntents : Application.ActivityLifecycleCallbacks {
    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {
        if (isNewOpening(activity.intent, savedInstanceState)) LiveUpdateEvents.opened(activity, activity.intent)
        // AndroidX tells an activity's listeners of each later intent. An activity of another kind has none to tell,
        // and an AndroidX older than the one this library asks for has no such listeners.
        try {
            (activity as? ComponentActivity)
                ?.addOnNewIntentListener(Consumer { intent -> LiveUpdateEvents.opened(activity, intent) })
        } catch (_: LinkageError) {
        }
    }

    /**
     * Whether the intent an activity is created with is one that just opened the app. It is not when Android creates
     * the activity again from its saved state, as after it ended the process in the background, and not when the
     * person brings back, from the recent apps, a task whose activity had gone: both get the first intent again,
     * which was counted when it was new.
     */
    internal fun isNewOpening(intent: Intent?, savedInstanceState: Bundle?): Boolean =
        savedInstanceState == null && (intent?.flags ?: 0) and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY == 0

    override fun onActivityStarted(activity: Activity) = Unit

    override fun onActivityResumed(activity: Activity) = Unit

    override fun onActivityPaused(activity: Activity) = Unit

    override fun onActivityStopped(activity: Activity) = Unit

    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

    override fun onActivityDestroyed(activity: Activity) = Unit
}
