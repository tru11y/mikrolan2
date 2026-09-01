import { useCallback, useEffect, useState } from 'react';
import { AppState, NativeModules, Platform } from 'react-native';

const { BatteryOptimization } = NativeModules as {
  BatteryOptimization?: {
    isIgnoringBatteryOptimizations: () => Promise<boolean>;
    requestIgnoreBatteryOptimizations: () => Promise<boolean>;
  };
};

export function useBatteryOptimization() {
  const [ignored, setIgnored] = useState<boolean | null>(null);
  const available = Platform.OS === 'android' && !!BatteryOptimization;

  const check = useCallback(() => {
    if (!available) return;
    BatteryOptimization!.isIgnoringBatteryOptimizations().then(setIgnored).catch(() => {});
  }, [available]);

  useEffect(() => {
    check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') check();
    });
    return () => sub.remove();
  }, [check]);

  const request = useCallback(async () => {
    if (!available) return;
    await BatteryOptimization!.requestIgnoreBatteryOptimizations();
    setTimeout(check, 500);
  }, [available, check]);

  return { available, ignored, request, recheck: check };
}
