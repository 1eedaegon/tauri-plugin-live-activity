package io.github.eedaegon.liveactivity

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.graphics.drawable.Icon
import android.net.Uri
import android.os.Build
import android.os.Bundle
import org.json.JSONObject
import kotlin.math.roundToInt

/** Not a prefix of the v1 tag, so the v1 port and earlier plugin versions never read these. */
internal const val LAYOUT_TAG_PREFIX = "tauri.live-activity.layout:"
internal const val LAYOUT_RECORD_EXTRA = "io.github.eedaegon.liveactivity.layoutRecord"
internal const val LAYOUT_DISMISS_ACTION = "io.github.eedaegon.liveactivity.LAYOUT_DISMISSED"

/**
 * Layout activities as notifications on the v1 channel. The notification keeps the Live Update
 * requirements: ongoing, a title, no custom views, not colorized, not a group summary, and a
 * standard or BigText style. A large icon is not among them.
 */
internal class LayoutNotifications(
    private val context: Context,
    private val samsungNowBar: () -> Boolean = { false },
    channelId: String = CHANNEL_ID,
) : Port<LayoutRecord, LayoutSnapshot> {
    private val base = AndroidNotifications(context, channelId)
    private val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    override fun notificationsAllowed() = base.notificationsAllowed()
    override fun promotionAllowed() = base.promotionAllowed()

    override fun observed(): Map<String, Observation<LayoutSnapshot>> = manager.activeNotifications.mapNotNull { entry ->
        if (entry.tag?.startsWith(LAYOUT_TAG_PREFIX) != true || entry.id != NOTIFICATION_ID) return@mapNotNull null
        val raw = entry.notification.extras.getString(LAYOUT_RECORD_EXTRA) ?: throw ActivityFailure("NATIVE_ERROR", "Activity notification metadata is missing.")
        val extra = try { LayoutNotificationExtra.fromJson(JSONObject(raw)) } catch (_: Exception) {
            throw ActivityFailure("NATIVE_ERROR", "Activity notification metadata is invalid.")
        }
        if (entry.tag != LAYOUT_TAG_PREFIX + extra.id) throw ActivityFailure("NATIVE_ERROR", "Activity notification identity does not match.")
        val stale = extra.snapshot.staleAt?.let { it <= System.currentTimeMillis() } ?: false
        val promotion = when {
            !extra.promotionRequested -> "notApplicable"
            Build.VERSION.SDK_INT >= 36 && entry.notification.flags and Notification.FLAG_PROMOTED_ONGOING != 0 -> "promoted"
            else -> "notPromoted"
        }
        extra.id to Observation(extra.snapshot, if (stale) "stale" else "active", extra.promotionRequested, promotion)
    }.toMap()

    override fun post(record: LayoutRecord) {
        base.ensureChannel()
        if (!notificationsAllowed()) throw ActivityFailure("PERMISSION_DENIED", "Notifications are disabled.")
        manager.notify(LAYOUT_TAG_PREFIX + record.id, NOTIFICATION_ID, build(record))
    }

    override fun cancel(id: String) { manager.cancel(LAYOUT_TAG_PREFIX + id, NOTIFICATION_ID) }

    // The promotion extra is public from API 36.1; older builds ignore an unknown extra.
    @SuppressLint("InlinedApi")
    fun build(record: LayoutRecord): Notification {
        val start = record.start
        val spec = LayoutProjection.project(start, record.snapshot.values)
        // A notification without a title cannot be promoted; the app's name stands in.
        val title = spec.title?.takeIf { it.isNotEmpty() } ?: context.applicationInfo.loadLabel(context.packageManager).toString()
        val extras = Bundle().apply { putString(LAYOUT_RECORD_EXTRA, record.extra().toString()) }
        if (Build.VERSION.SDK_INT >= 36 && record.promotionRequested) extras.putBoolean(Notification.EXTRA_REQUEST_PROMOTED_ONGOING, true)
        SamsungNowBar.extras(samsungNowBar(), Build.VERSION.SDK_INT, title, SamsungNowBar.secondary(spec)).forEach { (key, value) ->
            when {
                value is Int -> extras.putInt(key, value)
                SamsungNowBar.isCharSequence(key) -> extras.putCharSequence(key, value as String)
                else -> extras.putString(key, value as String)
            }
        }
        val builder = base.builder().setSmallIcon(R.drawable.live_activity_status).setContentTitle(title)
            .setCategory(if (spec.progress != null) Notification.CATEGORY_PROGRESS else Notification.CATEGORY_STATUS)
            .setOngoing(true).setOnlyAlertOnce(true).setVisibility(visibility(start.visibility)).setShowWhen(false)
            .setExtras(extras).setDeleteIntent(deleteIntent(record.id))
        base.contentIntent()?.let { builder.setContentIntent(it) }
        // The width of a line is unknown before posting, so every body gets BigTextStyle; a short one looks the same.
        spec.body?.takeIf { it.isNotEmpty() }?.let { builder.setContentText(it).setStyle(Notification.BigTextStyle().bigText(it)) }
        spec.progress?.let { builder.setProgress(1000, (it * 1000).roundToInt(), false) }
        spec.timer?.let {
            builder.setWhen(if (it.countsDown) it.end else it.start).setShowWhen(true).setUsesChronometer(true).setChronometerCountDown(it.countsDown)
        }
        spec.largeIcon?.let { name -> LayoutImages.icon(context, name)?.let { builder.setLargeIcon(it) } }
        spec.actions.forEach { builder.addAction(action(record.id, it)) }
        if (Build.VERSION.SDK_INT >= 36) spec.shortCriticalText?.let { builder.setShortCriticalText(it) }
        return builder.build()
    }

    private fun visibility(option: String?) = when (option) {
        "public" -> Notification.VISIBILITY_PUBLIC
        "secret" -> Notification.VISIBILITY_SECRET
        else -> Notification.VISIBILITY_PRIVATE
    }

    /** An explicit, immutable broadcast to the non-exported [ActionReceiver]; one per activity and action. */
    private fun action(id: String, spec: ActionSpec): Notification.Action {
        val data = Uri.Builder().scheme("tauri-live-activity").authority("action").appendPath(id).appendPath(spec.actionId).build()
        val intent = Intent(context, ActionReceiver::class.java).setAction(ACTION_TAPPED).setData(data)
            .putExtra("id", id).putExtra("actionId", spec.actionId)
        val pending = PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
        val action = Notification.Action.Builder(null as Icon?, spec.label, pending)
        // With false the system decides; it does not ask for the keyguard first.
        if (Build.VERSION.SDK_INT >= 31) action.setAuthenticationRequired(false)
        return action.build()
    }

    private fun deleteIntent(id: String): PendingIntent {
        val intent = Intent(context, DismissReceiver::class.java).setAction(LAYOUT_DISMISS_ACTION)
            .setData(Uri.parse("tauri-live-activity://dismiss-layout/$id")).putExtra("id", id)
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
}
