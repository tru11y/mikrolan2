import { api } from '@/src/lib/api';
import { getWifiInfo } from '@/src/lib/lanBinder';
import { reportSilent } from '@/src/lib/report';
import { getLocalCredentials, type LocalRouterCredentials } from '@/src/lib/router-credentials';
import { getStoredValue, setStoredValue } from '@/src/lib/storage';
import { withApi } from '@/src/services/mikrotik-lan/MikroTikApiClient';
import { createLanResolver, type LanRoute, type LanState } from './lanRouting.core';

/**
 * UNE seule source de vérité pour « puis-je parler à CE routeur en direct sur le LAN ? ».
 * Aucun écran ne décide lui-même d'après la passerelle/le sous-réseau : seule une identité RouterOS
 * lue sur le MikroTik joint ET égale à celle du routerId sélectionné donne `VERIFIED` (voir le core).
 */
const IDENTITY_TIMEOUT_MS = 4_000;
const EXPECTED_TTL_MS = 10 * 60_000;
const expectedCache = new Map<string, { identity: string; at: number }>();
const identityKey = (routerId: string) => `mikrolan_router_identity_${routerId}`;

/** Identité attendue : serveur (source), mémoire courte, puis dernier état connu (LAN sans Internet). */
async function expectedIdentity(routerId: string): Promise<string | null> {
  const hit = expectedCache.get(routerId);
  if (hit && Date.now() - hit.at < EXPECTED_TTL_MS) return hit.identity;
  try {
    const router = await api.routers.get(routerId);
    expectedCache.set(routerId, { identity: router.identity, at: Date.now() });
    void setStoredValue(identityKey(routerId), router.identity).catch((e) => reportSilent('lan-routing.store-identity', e, { routerId }));
    return router.identity;
  } catch {
    return (await getStoredValue(identityKey(routerId))) ?? null;
  }
}

const resolver = createLanResolver<LocalRouterCredentials>({
  getCreds: getLocalCredentials,
  getWifi: async () => {
    const wifi = await getWifiInfo();
    return wifi ? { gateway: wifi.gateway, ipAddress: wifi.ipAddress } : null;
  },
  expectedIdentity,
  readIdentity: async (creds) => (await withApi({ ...creds, timeoutMs: IDENTITY_TIMEOUT_MS }, (c) => c.systemIdentity())).name,
  now: () => Date.now(),
});

export type { LanRoute, LanState };

export function resolveVerifiedLanRoute(routerId: string): Promise<LanRoute<LocalRouterCredentials>> {
  return resolver.resolve(routerId);
}

/** Credentials LAN, ou `null` tant que l'identité du routeur n'est pas VERIFIED. */
export async function verifiedLanCreds(routerId: string): Promise<LocalRouterCredentials | null> {
  return (await resolver.resolve(routerId)).creds;
}

/** Wi-Fi/passerelle changé, retour au premier plan, reconnexion : toutes les preuves sont caduques. */
export function invalidateLanProofs(): void {
  resolver.invalidate();
}

/** Clé i18n expliquant pourquoi le LAN n'est pas utilisable (null si VERIFIED / pas de LAN du tout). */
export function lanBlockMessageKey(state: LanState): string | null {
  switch (state) {
    case 'MISMATCH':
    case 'NO_LAN':
      return 'routerDetail.lanOutOfReach';
    case 'UNREACHABLE':
      return 'routerDetail.lanOffline';
    case 'UNVERIFIABLE':
      return 'routerDetail.lanUnverifiable';
    default:
      return null;
  }
}
