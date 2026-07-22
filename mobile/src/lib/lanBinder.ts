import { NativeModules, Platform } from 'react-native';

export interface WifiInfo {
  ipAddress: string;
  gateway: string;
  netmask: string;
}

interface LanBinderNative {
  bindWifi(): Promise<boolean>;
  unbindWifi(): Promise<boolean>;
  getWifiInfo(): Promise<WifiInfo>;
}

const native = (NativeModules as { LanBinder?: LanBinderNative }).LanBinder;

export async function getWifiInfo(): Promise<WifiInfo | null> {
  if (Platform.OS !== 'android' || !native) return null;
  try {
    return await native.getWifiInfo();
  } catch {
    return null;
  }
}

/**
 * Runs `fn` with the app's sockets pinned to Wi-Fi, so LAN requests reach the
 * router even when its Wi-Fi has no internet (Android would otherwise route
 * over cellular). No-op on platforms/builds without the native module.
 */
export async function withWifi<T>(fn: () => Promise<T>): Promise<T> {
  if (Platform.OS !== 'android' || !native) return fn();
  try {
    await native.bindWifi();
  } catch {
    // fall through — try the request on the default network anyway
  }
  try {
    return await fn();
  } finally {
    try {
      await native.unbindWifi();
    } catch {
      // ignore
    }
  }
}
