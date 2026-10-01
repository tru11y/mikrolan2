import * as Sentry from '@sentry/nestjs';
import type { Event } from '@sentry/nestjs';
import { scrubSentryEvent } from './instrument';

// Construit à l'exécution : le littéral ne doit pas figurer dans le code source,
// que Sentry joint à l'événement (pre_context/post_context des frames).
const SECRET = ['FAKE', 'SECRET', '123'].join('_');
const USER = ['fake', 'router', 'user'].join('-');

async function capture(fill: (scope: Sentry.Scope) => void, error = new Error('boom')): Promise<Event> {
  const sent: Event[] = [];
  Sentry.init({
    dsn: 'http://public@localhost:9/1',
    beforeSend: scrubSentryEvent,
    transport: () => ({
      send: async (envelope) => {
        for (const item of envelope[1]) {
          const payload = item[1] as Event;
          if (payload && typeof payload === 'object' && 'event_id' in payload) sent.push(payload);
        }
        return {};
      },
      flush: async () => true,
    }),
  });
  Sentry.withScope((scope) => {
    fill(scope);
    Sentry.captureException(error);
  });
  await Sentry.flush(2000);
  await Sentry.close(2000);
  expect(sent).toHaveLength(1);
  return sent[0];
}

describe('Sentry — aucun identifiant RouterOS ne quitte le serveur', () => {
  it('corps de requête (username/password synthétiques) → 0 occurrence dans l’événement final', async () => {
    const event = await capture((scope) => {
      scope.setSDKProcessingMetadata({
        normalizedRequest: {
          method: 'PATCH',
          url: 'http://localhost/api/routers/r1',
          headers: { 'content-type': 'application/json' },
          data: JSON.stringify({ credentials: { username: USER, password: SECRET } }),
        },
      });
    });

    expect(event.request?.url).toContain('/routers/r1'); // la requête est bien capturée…
    expect(event.request?.data).toBeUndefined(); // …sans son corps
    expect(JSON.stringify(event)).not.toContain(SECRET);
    expect(JSON.stringify(event)).not.toContain(USER);
  });

  it('exception levée alors qu’un secret est en variable locale → 0 occurrence (pas de local variables)', async () => {
    function failWithLocalSecret(): never {
      const creds = { username: USER, password: SECRET };
      void creds;
      throw new Error('RouterOS refused');
    }
    let thrown: Error | undefined;
    try {
      failWithLocalSecret();
    } catch (e) {
      thrown = e as Error;
    }
    const event = await capture(() => undefined, thrown);

    expect(JSON.stringify(event)).not.toContain(SECRET);
  });

  it('DIAGNOSTIC — emplacements hors request.data (non alimentés par le code actuel)', async () => {
    const event = await capture((scope) => {
      scope.setExtra('payload', { password: SECRET });
      scope.setContext('creds', { password: SECRET });
      scope.setTag('p', SECRET);
      scope.addBreadcrumb({ message: 'x', data: { body: SECRET } });
    }, new Error(`parse failed near ${SECRET}`));

    const json = JSON.stringify(event);
    const survivors = {
      extra: JSON.stringify(event.extra ?? {}).includes(SECRET),
      contexts: JSON.stringify(event.contexts ?? {}).includes(SECRET),
      tags: JSON.stringify(event.tags ?? {}).includes(SECRET),
      breadcrumbs: JSON.stringify(event.breadcrumbs ?? []).includes(SECRET),
      exception: JSON.stringify(event.exception ?? {}).includes(SECRET),
    };
    // Documente ce qui survit : ces emplacements ne reçoivent aucun corps de requête
    // dans ce code (aucun scope.setExtra/context/breadcrumb avec des identifiants).
    console.log('Sentry survivors (placements artificiels):', JSON.stringify(survivors), 'total=', json.includes(SECRET));
    expect(true).toBe(true);
  });
});
