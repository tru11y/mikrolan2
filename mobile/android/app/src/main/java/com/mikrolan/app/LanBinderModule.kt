package com.mikrolan.app

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.os.Build
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Routes the app's sockets through Wi-Fi while managing a router locally.
 * Without this, when the router's Wi-Fi has no internet Android sends requests
 * over cellular, so the LAN (e.g. 192.168.88.1) is unreachable.
 */
class LanBinderModule(private val ctx: ReactApplicationContext) :
    ReactContextBaseJavaModule(ctx) {

  private var callback: ConnectivityManager.NetworkCallback? = null

  override fun getName(): String = "LanBinder"

  private fun cm(): ConnectivityManager =
      ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

  @ReactMethod
  fun bindWifi(promise: Promise) {
    try {
      val manager = cm()
      unbindInternal(manager)
      val request = NetworkRequest.Builder()
          .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
          .build()
      val cb = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
          val ok =
              if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M)
                  manager.bindProcessToNetwork(network)
              else false
          promise.resolve(ok)
        }
        override fun onUnavailable() {
          promise.resolve(false)
        }
      }
      callback = cb
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        manager.requestNetwork(request, cb, 8000)
      } else {
        manager.requestNetwork(request, cb)
      }
    } catch (e: Exception) {
      promise.reject("bind_error", e.message, e)
    }
  }

  @ReactMethod
  fun unbindWifi(promise: Promise) {
    try {
      unbindInternal(cm())
      promise.resolve(true)
    } catch (e: Exception) {
      promise.reject("unbind_error", e.message, e)
    }
  }

  private fun unbindInternal(manager: ConnectivityManager) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
      manager.bindProcessToNetwork(null)
    }
    callback?.let {
      try {
        manager.unregisterNetworkCallback(it)
      } catch (_: Exception) {}
    }
    callback = null
  }
}
