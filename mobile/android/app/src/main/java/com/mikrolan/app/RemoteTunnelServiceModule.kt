package com.mikrolan.app

import android.content.Intent
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

/**
 * Pilote `RemoteTunnelService` depuis JS : `start({expiresAtMs, title, body})`
 * et `stop()`. Émet l'événement `RemoteTunnelClose` quand l'utilisateur touche
 * l'action « Fermer » de la notification persistante.
 */
class RemoteTunnelServiceModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {

  override fun getName(): String = "RemoteTunnelService"

  @ReactMethod
  fun start(options: ReadableMap, promise: Promise) {
    try {
      val expiresAtMs =
          if (options.hasKey("expiresAtMs")) options.getDouble("expiresAtMs").toLong() else 0L
      val title = if (options.hasKey("title")) options.getString("title") else null
      val body = if (options.hasKey("body")) options.getString("body") else null

      RemoteTunnelService.onCloseRequested = { emitClose() }

      val intent = Intent(ctx, RemoteTunnelService::class.java).apply {
        putExtra(RemoteTunnelService.EXTRA_EXPIRES_AT, expiresAtMs)
        putExtra(RemoteTunnelService.EXTRA_TITLE, title)
        putExtra(RemoteTunnelService.EXTRA_BODY, body)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        ctx.startForegroundService(intent)
      } else {
        ctx.startService(intent)
      }
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("remote_tunnel_start_error", e.message, e)
    }
  }

  @ReactMethod
  fun stop(promise: Promise) {
    try {
      RemoteTunnelService.onCloseRequested = null
      ctx.stopService(Intent(ctx, RemoteTunnelService::class.java))
      promise.resolve(null)
    } catch (e: Exception) {
      promise.reject("remote_tunnel_stop_error", e.message, e)
    }
  }

  /** Requis par NativeEventEmitter (nouvelle archi) — pas d'abonnement natif. */
  @ReactMethod
  fun addListener(eventName: String) {}

  @ReactMethod
  fun removeListeners(count: Int) {}

  private fun emitClose() {
    if (!ctx.hasActiveReactInstance()) return
    ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        .emit("RemoteTunnelClose", null)
  }
}
