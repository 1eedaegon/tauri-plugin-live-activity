package io.github.eedaegon.liveactivity

import android.app.NotificationManager
import android.content.Context
import android.os.Build

/** liveupdate's notification channel, which every activity of the plugin posts to. */
internal const val CHANNEL_ID = "liveupdate-rs.v1"

/** What the notification settings allow, for the plugin's permissions. */
internal class AndroidNotifications(context: Context, private val channelId: String = CHANNEL_ID) {
    private val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    fun notificationsAllowed(): Boolean {
        if (!manager.areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT < 26) return true
        val channel = manager.getNotificationChannel(channelId) ?: return true
        return channel.importance != NotificationManager.IMPORTANCE_NONE
    }

    fun promotionAllowed(): Boolean {
        if (Build.VERSION.SDK_INT < 36 || !manager.canPostPromotedNotifications()) return false
        val importance = manager.getNotificationChannel(channelId)?.importance ?: NotificationManager.IMPORTANCE_LOW
        return importance > NotificationManager.IMPORTANCE_MIN
    }
}
