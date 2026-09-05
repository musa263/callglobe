package app.vocivo.sip

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.os.Build

/** Self-managed Telecom never draws the app's ringing UI for us. */
object VocivoSipCallNotification {
  private const val CHANNEL = "vocivo_sip_incoming_v1"
  const val SERVICE_ID = 7600

  private fun action(context: Context, callId: String, answer: Boolean): PendingIntent {
    val intent = Intent(context, if (answer) VocivoSipCallActivity::class.java else VocivoSipDeclineReceiver::class.java)
      .setAction(if (answer) "ANSWER" else "DECLINE")
      .setData(Uri.parse("vocivo-call://action/${Uri.encode(callId)}"))
      .putExtra("callId", callId)
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    return if (answer) PendingIntent.getActivity(context, 0, intent, flags)
      else PendingIntent.getBroadcast(context, 0, intent, flags)
  }

  fun build(context: Context, callId: String, name: String, incoming: Boolean): Notification {
    val manager = context.getSystemService(NotificationManager::class.java)
    val channel = if (incoming) CHANNEL else "vocivo_sip_active_v1"
    if (Build.VERSION.SDK_INT >= 26) manager.createNotificationChannel(NotificationChannel(channel, if (incoming) "Incoming Vocivo calls" else "Active Vocivo calls", if (incoming) NotificationManager.IMPORTANCE_HIGH else NotificationManager.IMPORTANCE_LOW).apply {
      setSound(if (incoming) RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE) else null, AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE).build())
      enableVibration(incoming)
      lockscreenVisibility = Notification.VISIBILITY_PUBLIC
    })
    val open = PendingIntent.getActivity(context, 0, Intent(context, VocivoSipCallActivity::class.java)
      .setData(Uri.parse("vocivo-call://show/${Uri.encode(callId)}"))
      .putExtra("callId", callId), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    val decline = action(context, callId, false)
    val builder = (if (Build.VERSION.SDK_INT >= 26) Notification.Builder(context, channel) else Notification.Builder(context))
      .setSmallIcon(context.applicationInfo.icon)
      .setContentTitle(name.ifBlank { "Incoming call" })
      .setContentText(if (incoming) "Incoming Vocivo call" else "Call in progress")
      .setCategory(Notification.CATEGORY_CALL).setOngoing(true)
      .setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PUBLIC)
      .setContentIntent(open)
    if (Build.VERSION.SDK_INT < 26 && incoming) builder.setPriority(Notification.PRIORITY_MAX)
      .setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))
    if (Build.VERSION.SDK_INT >= 31) {
      val person = Person.Builder().setName(name.ifBlank { "Incoming call" }).setImportant(true).build()
      builder.setStyle(if (incoming) Notification.CallStyle.forIncomingCall(person, decline, action(context, callId, true))
        else Notification.CallStyle.forOngoingCall(person, decline))
    } else {
      builder.addAction(Notification.Action.Builder(null, "Decline", decline).build())
      if (incoming) builder.addAction(Notification.Action.Builder(null, "Answer", action(context, callId, true)).build())
    }
    if (incoming && (Build.VERSION.SDK_INT < 34 || manager.canUseFullScreenIntent())) builder.setFullScreenIntent(open, true)
    return builder.build()
  }

  fun show(context: Context, callId: String, name: String, incoming: Boolean) {
    context.getSystemService(NotificationManager::class.java).notify(callId, 1, build(context, callId, name, incoming))
  }

  fun cancel(context: Context, callId: String) {
    context.getSystemService(NotificationManager::class.java).cancel(callId, 1)
  }
}

class VocivoSipDeclineReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    val id = intent.getStringExtra("callId") ?: return
    val connection = VocivoSipCallRegistry.connection(id) ?: return
    if (connection.state == android.telecom.Connection.STATE_ACTIVE) connection.onDisconnect() else connection.onReject()
  }
}
