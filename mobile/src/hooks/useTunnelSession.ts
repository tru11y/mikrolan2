import { useCallback, useEffect, useRef, useState } from 'react';
import { TunnelRuntime } from '@/src/services/remote-tunnel/tunnelRuntime';
import {
  initialSessionState,
  type SessionState,
} from '@/src/services/remote-tunnel/tunnelSession';

/**
 * Pilote une `TunnelRuntime` et expose son état réactif à l'écran.
 * Toute la logique vit dans le runtime / la machine d'états ; ce hook ne fait
 * que relier le cycle de vie React (montage/démontage → fermeture du tunnel).
 */
export function useTunnelSession(routerId: string) {
  const [state, setState] = useState<SessionState>(initialSessionState);
  const runtimeRef = useRef<TunnelRuntime | null>(null);

  const ensureRuntime = useCallback((): TunnelRuntime => {
    if (!runtimeRef.current) {
      runtimeRef.current = new TunnelRuntime(routerId, setState);
    }
    return runtimeRef.current;
  }, [routerId]);

  const open = useCallback(
    (durationMinutes: number) => ensureRuntime().open(durationMinutes),
    [ensureRuntime],
  );

  const close = useCallback(() => {
    runtimeRef.current?.close();
    runtimeRef.current = null;
  }, []);

  useEffect(
    () => () => {
      runtimeRef.current?.close();
      runtimeRef.current = null;
    },
    [],
  );

  return { state, open, close };
}
