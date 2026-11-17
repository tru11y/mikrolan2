import { Linking } from 'react-native';
import { Sentry } from '@/src/lib/sentry';

const API = process.env.EXPO_PUBLIC_API_BASE_URL ?? '';

export async function fireJs(): Promise<void> {
  // Faux secrets reconnaissables, aucune valeur réelle.
  const FAKE_JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJGQUtFLVVTRVIifQ.ZmFrZS1zaWduYXR1cmUtZGV2dGVzdA';
  const FAKE_WG = 'FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKEFA0=';
  const leak = 'Bearer ' + FAKE_JWT + ' mail fake.user@example.test tel +225 07 00 00 00 01 ip4 192.168.77.5 ip6 2001:db8:85a3:0:0:8a2e:370:7334 mac AA:BB:CC:00:11:22 wg ' + FAKE_WG;
  Sentry.addBreadcrumb({ category: 'console', message: 'login fake.user@example.test ?token=FAKETOKEN2 10.9.8.7', level: 'info' });
  try {
    await fetch(API + '/routers/ckfakerouter0000000000000003/vouchers/search?q=8p1190', {
      headers: { Authorization: 'Bearer ' + FAKE_JWT },
    });
  } catch {
    // l'échec réseau fait aussi partie du scénario (breadcrumb fetch)
  }
  try {
    await fetch(API + '/auth/login', { method: 'POST', body: JSON.stringify({ email: 'fake.user@example.test', password: 'FAKE-ROUTER-PASSWORD-11' }) });
  } catch {
    // idem
  }
  Sentry.captureException(new Error('devtest synthetic JS error ' + leak + ' code 8p1190 voucher ckvoucher000000000000003 batch ckbatch0000000000000003 saspay REF-FAKE-SASPAY-3 routeros pass FAKE-ROUTER-PASSWORD-11'), {
    tags: { role: 'OWNER', ticketCode: '8p1190', who: 'fake.user@example.test' },
    extra: { routerId: 'ckfakerouter0000000000000003', voucherId: 'ckvoucher000000000000003', batchId: 'ckbatch0000000000000003', voucherCode: '8p1190', routerPassword: 'FAKE-ROUTER-PASSWORD-11', saspayReference: 'REF-FAKE-SASPAY-3', wgPrivateKey: FAKE_WG, nested: { deep: { Authorization: 'Bearer ' + FAKE_JWT, note: leak } } },
    contexts: { saspay: { reference: 'REF-FAKE-SASPAY-3', body: { msisdn: '+2250700000001', amount: 1000 } } },
  });
  await Sentry.flush();
}

export function installDevtestTrigger(): void {
  if (process.env.EXPO_PUBLIC_SENTRY_ENV !== 'devtest') return;
  const handle = (url: string | null) => {
    if (!url) return;
    if (url.includes('sentrydevtest-js')) void fireJs();
    if (url.includes('sentrydevtest-native')) Sentry.nativeCrash();
  };
  void Linking.getInitialURL().then(handle);
  Linking.addEventListener('url', (e) => handle(e.url));
}
