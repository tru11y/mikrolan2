/**
 * Télémétrie des routeurs : 30 jours (annoncé dans la politique de confidentialité).
 * DB PostgreSQL réelle (testcontainers).
 */
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ManagementMode } from '@prisma/client';
import { createTestApp } from '../helpers/app.helper';
import { signupUser } from '../helpers/auth.helper';
import { PrismaService } from '../../src/prisma/prisma.service';
import { TelemetryService } from '../../src/modules/telemetry/telemetry.service';

const DAY_MS = 86_400_000;

describe('RouterTelemetry — rétention 30 jours (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('supprime les mesures de plus de 30 jours et conserve les plus récentes', async () => {
    const u = await signupUser(app);
    const { tenantId } = await prisma.user.findUniqueOrThrow({ where: { email: u.email.toLowerCase() } });
    const router = await prisma.router.create({ data: { tenantId, identity: `telemetry-${Date.now()}`, mode: ManagementMode.LOCAL } });
    const at = (days: number) => new Date(Date.now() - days * DAY_MS);
    const old = await prisma.routerTelemetry.create({ data: { routerId: router.id, collectedAt: at(35) } });
    const edge = await prisma.routerTelemetry.create({ data: { routerId: router.id, collectedAt: at(29) } });
    const recent = await prisma.routerTelemetry.create({ data: { routerId: router.id, collectedAt: at(1) } });

    expect(await app.get(TelemetryService).cleanup()).toBeGreaterThanOrEqual(1);

    expect(await prisma.routerTelemetry.findUnique({ where: { id: old.id } })).toBeNull();
    expect(await prisma.routerTelemetry.findUnique({ where: { id: edge.id } })).not.toBeNull();
    expect(await prisma.routerTelemetry.findUnique({ where: { id: recent.id } })).not.toBeNull();
  });
});
