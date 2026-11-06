package io.github.eedaegon.liveactivity

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

class DismissReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != DISMISS_ACTION && intent.action != LAYOUT_DISMISS_ACTION) return
        val id = intent.getStringExtra("id") ?: return
        synchronized(ACTIVITY_LOCK) {
            DismissalMemory.remember(id)
            try {
                if (intent.action == DISMISS_ACTION) dismissTemplate(PreferencesStore(context), id) else dismissLayout(LayoutPreferencesStore(context), id)
                DismissalMemory.forget(id)
            } catch (_: Exception) {
                // Keep the in-process tombstone even if disk persistence fails; never repost on a late update.
                Log.e("LiveActivity", "Could not persist activity dismissal.")
            }
        }
    }

    private fun dismissTemplate(store: RecordStore, id: String) {
        store.write(store.read().map { if (it.id == id && !it.terminal) it.copy(state = "dismissed") else it })
    }

    private fun dismissLayout(store: Store<LayoutRecord>, id: String) {
        val records = store.read()
        if (records.any { it.id == id && !it.terminal }) store.write(records.map { if (it.id == id && !it.terminal) it.copy(state = "dismissed") else it })
    }
}
