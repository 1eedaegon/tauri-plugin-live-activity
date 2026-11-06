package io.github.eedaegon.liveactivity

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

internal const val ACTION_TAPPED = "io.github.eedaegon.liveactivity.ACTION"

/**
 * Receives the immutable, explicit PendingIntent of a notification action. It is not exported and
 * needs no plugin object: when the tap started the process, the tap waits in [ActionHub] until the
 * Tauri runtime registers its channel in this process, and is lost if the process ends first.
 */
class ActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_TAPPED) return
        val id = intent.getStringExtra("id") ?: return
        val actionId = intent.getStringExtra("actionId") ?: return
        val store = LayoutPreferencesStore(context.applicationContext)
        // Keeps the process up while the store is read and the tap is handed over. Only a
        // broadcast that the system dispatched has a result; a direct call gets null.
        val result: PendingResult? = goAsync()
        ActionHub.execute {
            val tap = try {
                synchronized(ACTIVITY_LOCK) { ActionTaps.resolve(store.read(), id, actionId) }
            } catch (_: Exception) {
                Log.e("LiveActivity", "Could not read layout activities for an action.")
                ActionTap(actionId, id, null)
            }
            if (tap == null) result?.finish() else ActionHub.offer(tap) { result?.finish() }
        }
    }
}
