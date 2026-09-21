import { reportSilent } from '@/src/lib/report';
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
  } catch (e) {
    reportSilent('lan.wifi-info', e);
    return null;
  }
}

// The LAN client pins its TCP socket to Wi-Fi; opening it toward an unreachable
// router (mobile data, or a Wi-Fi that isn't the router's) makes
// react-native-tcp-socket throw on a native thread ("No socket with id 0") and
// hard-crashes the app. So only attempt LAN when the router's host is on the
// current Wi-Fi subnet; otherwise go straight to the tunnel.
export function sameSubnet24(a: string, b: string): boolean {
  return a.split('.').slice(0, 3).join('.') === b.split('.').slice(0, 3).join('.');
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
  } catch (e) {
    // Try the request on the default network anyway, but keep the trace.
    reportSilent('lan.bind-wifi', e);
  }
  try {
    return await fn();
  } finally {
    try {
      await native.unbindWifi();
    } catch (e) {
      reportSilent('lan.unbind-wifi', e);
    }
  }
}
