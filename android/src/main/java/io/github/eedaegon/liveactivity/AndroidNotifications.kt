package io.github.eedaegon.liveactivity

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.os.Build

internal const val CHANNEL_ID = "tauri.live-activity.v1"
internal const val TAG_PREFIX = "tauri.live-activity:"
internal const val RECORD_EXTRA = "io.github.eedaegon.liveactivity.record"
internal const val NOTIFICATION_ID = 1

internal class AndroidNotifications(private val context: Context, private val channelId: String = CHANNEL_ID) {
    private val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    internal fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel(channelId, "Live activities", NotificationManager.IMPORTANCE_LOW))
        }
    }

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

    @Suppress("DEPRECATION")
    internal fun builder(): Notification.Builder = if (Build.VERSION.SDK_INT >= 26) {
        Notification.Builder(context, channelId)
    } else Notification.Builder(context).setPriority(Notification.PRIORITY_LOW)

    internal fun contentIntent(): PendingIntent? {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
        return PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

}
