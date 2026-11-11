import request from 'supertest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp } from '../helpers/app.helper';

/** Preuve réelle (vrai limiteur, vrai HTTP) : les routes publiques sensibles répondent 429 au-delà de leur plafond. */
describe('Limitation de débit (e2e, limiteur réel)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createTestApp({ realThrottle: true });
  });
  afterAll(async () => {
    await app.close();
  });

  const hammer = async (path: string, body: object, times: number) => {
    const codes: number[] = [];
    for (let i = 0; i < times; i++) codes.push((await request(app.getHttpServer()).post(path).send(body)).status);
    return codes;
  };

  it('POST /auth/login : 429 dès la 11e tentative (plafond 10/min par IP)', async () => {
    const codes = await hammer('/api/auth/login', { email: 'nobody@e2e.local', password: 'Wrong-pass-123' }, 12);
    expect(codes.slice(0, 10).every((c) => c !== 429)).toBe(true);
    expect(codes.slice(10)).toEqual([429, 429]);
  });

  it('POST /auth/password-reset/request : 429 au-delà du plafond', async () => {
    const codes = await hammer('/api/auth/password-reset/request', { email: 'nobody@e2e.local' }, 7);
    expect(codes).toContain(429);
  });
});
