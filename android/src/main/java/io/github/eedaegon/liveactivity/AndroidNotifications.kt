package io.github.eedaegon.liveactivity

import android.app.Notification
import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import org.json.JSONObject
import kotlin.math.roundToInt

internal const val CHANNEL_ID = "tauri.live-activity.v1"
internal const val TAG_PREFIX = "tauri.live-activity:"
internal const val RECORD_EXTRA = "io.github.eedaegon.liveactivity.record"
internal const val DISMISS_ACTION = "io.github.eedaegon.liveactivity.DISMISSED"
private const val NOTIFICATION_ID = 1

internal class AndroidNotifications(private val context: Context, private val channelId: String = CHANNEL_ID) : NotificationPort {
    private val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(NotificationChannel(channelId, "Live activities", NotificationManager.IMPORTANCE_LOW))
        }
    }

    override fun notificationsAllowed(): Boolean {
        if (!manager.areNotificationsEnabled()) return false
        if (Build.VERSION.SDK_INT < 26) return true
        val channel = manager.getNotificationChannel(channelId) ?: return true
        return channel.importance != NotificationManager.IMPORTANCE_NONE
    }

    override fun promotionAllowed(): Boolean {
        if (Build.VERSION.SDK_INT < 36 || !manager.canPostPromotedNotifications()) return false
        val importance = manager.getNotificationChannel(channelId)?.importance ?: NotificationManager.IMPORTANCE_LOW
        return importance > NotificationManager.IMPORTANCE_MIN
    }

    override fun observed(): Map<String, ActivityRecord> = manager.activeNotifications.mapNotNull { entry ->
        if (entry.tag?.startsWith(TAG_PREFIX) != true || entry.id != NOTIFICATION_ID) return@mapNotNull null
        val raw = entry.notification.extras.getString(RECORD_EXTRA) ?: throw ActivityFailure("NATIVE_ERROR", "Activity notification metadata is missing.")
        val record = try { ActivityRecord.fromJson(JSONObject(raw)) } catch (_: Exception) {
            throw ActivityFailure("NATIVE_ERROR", "Activity notification metadata is invalid.")
        }
        if (entry.tag != TAG_PREFIX + record.id) throw ActivityFailure("NATIVE_ERROR", "Activity notification identity does not match.")
        val stale = record.snapshot.staleAt?.let { it <= System.currentTimeMillis() } ?: false
        val promotion = when {
            !record.promotionRequested -> "notApplicable"
            Build.VERSION.SDK_INT >= 36 && entry.notification.flags and Notification.FLAG_PROMOTED_ONGOING != 0 -> "promoted"
            else -> "notPromoted"
        }
        record.id to record.copy(state = if (stale) "stale" else "active", promotionState = promotion, awaitingObservation = false)
    }.toMap()

    // An unknown primitive extra is ignored on older builds; actual promotion is read from OS flags.
    @SuppressLint("InlinedApi")
    override fun post(record: ActivityRecord) {
        ensureChannel()
        if (!notificationsAllowed()) throw ActivityFailure("PERMISSION_DENIED", "Notifications are disabled.")
        val builder = builder().setSmallIcon(R.drawable.live_activity_status)
            .setContentTitle(record.snapshot.title).setContentText(record.snapshot.status)
            .setCategory(Notification.CATEGORY_PROGRESS).setOngoing(true).setOnlyAlertOnce(true)
            .setVisibility(Notification.VISIBILITY_PRIVATE).setShowWhen(false)
            .setExtras(Bundle().apply { putString(RECORD_EXTRA, record.json(internal = true).toString()) })
            .setDeleteIntent(deleteIntent(record.id))
        contentIntent()?.let { builder.setContentIntent(it) }
        record.snapshot.progress?.let { builder.setProgress(1000, (it * 1000).roundToInt(), false) }
        record.snapshot.timer?.let {
            builder.setWhen(it.endsAt).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(true)
        }
        if (Build.VERSION.SDK_INT >= 36 && record.promotionRequested) {
            // The equivalent Builder method requires API 36.1; the documented extra is inlined.
            builder.addExtras(Bundle().apply { putBoolean(Notification.EXTRA_REQUEST_PROMOTED_ONGOING, true) })
        }
        manager.notify(TAG_PREFIX + record.id, NOTIFICATION_ID, builder.build())
    }

    @Suppress("DEPRECATION")
    private fun builder(): Notification.Builder = if (Build.VERSION.SDK_INT >= 26) {
        Notification.Builder(context, channelId)
    } else Notification.Builder(context).setPriority(Notification.PRIORITY_LOW)

    private fun contentIntent(): PendingIntent? {
        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return null
        return PendingIntent.getActivity(context, 0, launch, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun deleteIntent(id: String): PendingIntent {
        val intent = Intent(context, DismissReceiver::class.java).setAction(DISMISS_ACTION)
            .setData(Uri.parse("tauri-live-activity://dismiss/$id")).putExtra("id", id)
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    override fun cancel(id: String) { manager.cancel(TAG_PREFIX + id, NOTIFICATION_ID) }
}
