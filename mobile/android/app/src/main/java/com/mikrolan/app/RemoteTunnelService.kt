package com.mikrolan.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.core.app.NotificationCompat

/**
 * Foreground service (type `connectedDevice`) tenu pendant la fenêtre d'accès
 * distant Winbox. Il maintient une notification persistante non-balayable le
 * temps que l'utilisateur bascule vers l'app Winbox native (hors MikroLan), de
 * sorte que le pont TCP loopback 127.0.0.1:8291 survive écran éteint.
 *
 * L'action « Fermer » de la notification remonte au module JS
 * (`RemoteTunnelServiceModule.onCloseRequested`) qui ferme le tunnel +
 * `close-access`. Un timer coupe aussi le service à `expiresAtMs`.
 *
 * Clean-room : écrit depuis la spec v2 (plan docs/remote-access), API Android
 * standard uniquement.
 */
class RemoteTunnelService : Service() {

  private val handler = Handler(Looper.getMainLooper())
  private var expiryRunnable: Runnable? = null
  private var closeReceiver: BroadcastReceiver? = null

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val title = intent?.getStringExtra(EXTRA_TITLE) ?: "Tunnel MikroLan actif"
    val body = intent?.getStringExtra(EXTRA_BODY) ?: ""
    val expiresAtMs = intent?.getLongExtra(EXTRA_EXPIRES_AT, 0L) ?: 0L

    createChannel()
    registerCloseReceiver()
    startForegroundNotification(title, body)
    armAutoStop(expiresAtMs)
    return START_NOT_STICKY
  }

  private fun createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
    val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (mgr.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(
        CHANNEL_ID,
        "Accès distant",
        NotificationManager.IMPORTANCE_LOW,
    )
    channel.description = "Notification active pendant une session d'accès distant."
    channel.setShowBadge(false)
    mgr.createNotificationChannel(channel)
  }

  private fun startForegroundNotification(title: String, body: String) {
    val closeIntent = PendingIntent.getBroadcast(
        this,
        0,
        Intent(ACTION_CLOSE).setPackage(packageName),
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )
    val notif: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
        .setContentTitle(title)
        .setContentText(body)
        .setSmallIcon(R.drawable.notification_icon)
        .setOngoing(true)
        .setPriority(NotificationCompat.PRIORITY_LOW)
        .setCategory(NotificationCompat.CATEGORY_SERVICE)
        .addAction(0, "Fermer", closeIntent)
        .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE)
    } else {
      startForeground(NOTIF_ID, notif)
    }
  }

  private fun armAutoStop(expiresAtMs: Long) {
    expiryRunnable?.let { handler.removeCallbacks(it) }
    if (expiresAtMs <= 0L) return
    val delay = expiresAtMs - System.currentTimeMillis()
    val runnable = Runnable { stopInternal() }
    expiryRunnable = runnable
    handler.postDelayed(runnable, if (delay > 0L) delay else 0L)
  }

  private fun registerCloseReceiver() {
    if (closeReceiver != null) return
    val receiver = object : BroadcastReceiver() {
      override fun onReceive(context: Context?, intent: Intent?) {
        onCloseRequested?.invoke()
        stopInternal()
      }
    }
    closeReceiver = receiver
    val filter = IntentFilter(ACTION_CLOSE)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("UnspecifiedRegisterReceiverFlag")
      registerReceiver(receiver, filter)
    }
  }

  private fun stopInternal() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    stopSelf()
  }

  override fun onDestroy() {
    expiryRunnable?.let { handler.removeCallbacks(it) }
    expiryRunnable = null
    closeReceiver?.let {
      try {
        unregisterReceiver(it)
      } catch (_: Exception) {}
    }
    closeReceiver = null
    super.onDestroy()
  }

  companion object {
    const val CHANNEL_ID = "tunnel"
    const val NOTIF_ID = 4291
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"
    const val EXTRA_EXPIRES_AT = "expiresAtMs"
    const val ACTION_CLOSE = "com.mikrolan.app.REMOTE_TUNNEL_CLOSE"

    /** Callback invoqué quand l'utilisateur touche « Fermer ». */
    @Volatile
    var onCloseRequested: (() -> Unit)? = null
  }
}
