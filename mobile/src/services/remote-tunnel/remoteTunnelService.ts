/**
 * Façade TypeScript du foreground service Android `RemoteTunnelService`
 * (module natif Kotlin maison). Elle pilote une notification persistante
 * « Tunnel MikroLan actif » pendant la fenêtre d'accès, le temps que
 * l'utilisateur bascule vers l'app Winbox native (qui vit hors de MikroLan).
 *
 * - `start` doit être appelé **tant que l'app est au premier plan** (contrainte
 *   Android 15 sur le démarrage d'un FGS depuis le background).
 * - L'action « Fermer » de la notification remonte via `onClose` : l'appelant
 *   doit alors fermer le tunnel + `close-access`.
 *
 * Hors Android (iOS, tests Node), toutes les méthodes sont des no-ops : le
 * module natif n'existe pas et le forward Winbox n'est pas proposé.
 */

import { NativeEventEmitter, NativeModules, Platform } from 'react-native';

export type RemoteTunnelServiceOptions = {
  /** ms epoch de fin de fenêtre : le service s'auto-arrête à cette échéance. */
  expiresAtMs: number;
  /** Titre de la notification persistante. */
  title: string;
  /** Texte de la notification (ex. « Expire à 14:05 »). */
  body: string;
};

/** Contrat exposé par le module natif Kotlin. */
interface NativeRemoteTunnelService {
  start(options: RemoteTunnelServiceOptions): Promise<void>;
  stop(): Promise<void>;
  /** Requis par NativeEventEmitter (nouvelle archi). */
  addListener(eventName: string): void;
  removeListeners(count: number): void;
}

/** Événement émis par le natif quand l'utilisateur touche « Fermer ». */
export const REMOTE_TUNNEL_CLOSE_EVENT = 'RemoteTunnelClose';

function nativeModule(): NativeRemoteTunnelService | null {
  if (Platform.OS !== 'android') return null;
  const mod = (NativeModules as Record<string, unknown>).RemoteTunnelService;
  return (mod as NativeRemoteTunnelService | undefined) ?? null;
}

/** Vrai si le FGS natif est disponible (Android + module lié). */
export function isRemoteTunnelServiceAvailable(): boolean {
  return nativeModule() !== null;
}

/**
 * Démarre le foreground service. No-op (résolu) si le natif est absent, pour
 * ne jamais bloquer le flux tunnel sur une plateforme sans FGS.
 */
export async function startRemoteTunnelService(
  options: RemoteTunnelServiceOptions,
): Promise<void> {
  const mod = nativeModule();
  if (!mod) return;
  await mod.start(options);
}

/** Arrête le foreground service (idempotent côté natif). */
export async function stopRemoteTunnelService(): Promise<void> {
  const mod = nativeModule();
  if (!mod) return;
  await mod.stop();
}

/**
 * S'abonne à l'action « Fermer » de la notification. Renvoie une fonction de
 * désabonnement ; no-op si le natif est absent.
 */
export function subscribeRemoteTunnelClose(onClose: () => void): () => void {
  const mod = nativeModule();
  if (!mod) return () => {};
  const emitter = new NativeEventEmitter(
    mod as unknown as ConstructorParameters<typeof NativeEventEmitter>[0],
  );
  const sub = emitter.addListener(REMOTE_TUNNEL_CLOSE_EVENT, onClose);
  return () => sub.remove();
}
