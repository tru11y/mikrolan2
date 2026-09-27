import { NotFoundException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { tenantStore, setTenantContext } from '../../common/context/tenant-context';
import { RouterLiveController } from './router-live.controller';
import { RouterGatewayService } from './router-gateway.service';
import { RouterLiveEventsService } from './router-live-events.service';

/**
 * Reproduit le comportement réel : `Router` est un modèle tenant-scopé
 * (`common/prisma/prisma.service.ts`, `TENANT_MODELS`), donc tout `findFirst`
 * est automatiquement filtré par `getTenantContext().tenantId` — un router
 * d'un autre tenant ne matche jamais, quel que soit son `id`.
 */
function fakePrisma(routers: { id: string; tenantId: string }[]) {
  return {
    router: {
      findFirst: jest.fn(async ({ where }: { where: { id: string } }) => {
        const tenantId = tenantStore.getStore()?.ctx?.tenantId;
        return routers.find((r) => r.id === where.id && r.tenantId === tenantId) ?? null;
      }),
    },
  };
}

const asTenant = <T>(tenantId: string, fn: () => Promise<T>): Promise<T> =>
  tenantStore.run({}, () => {
    setTenantContext({ tenantId, userId: 'u1', role: UserRole.OWNER });
    return fn();
  });

const ROUTER_B = { id: 'router-b', tenantId: 'tenant-b' };
const mockRemote = { run: jest.fn() };

beforeEach(() => jest.clearAllMocks());

describe('RouterLiveController — sécurité multi-tenant (le cache HIT ne doit jamais contourner la propriété)', () => {
  it("tenant A ne peut jamais récupérer le snapshot du routeur de tenant B, même si ce snapshot est déjà chaud en cache", async () => {
    const prisma = fakePrisma([ROUTER_B]);
    const gateway = new RouterGatewayService(mockRemote as never, new RouterLiveEventsService());
    mockRemote.run.mockImplementation((_id: string, fn: (c: unknown) => unknown) =>
      fn({ command: async () => [{ 'cpu-load': '10' }] }),
    );
    const controller = new RouterLiveController(gateway, prisma as never);

    // 1) Tenant B (le propriétaire légitime) réchauffe le cache.
    const asOwner = await asTenant('tenant-b', () => controller.live(ROUTER_B.id));
    expect(asOwner.cpuPercent).toBe(10);
    expect(mockRemote.run).toHaveBeenCalledTimes(1);

    // 2) Tenant A tente le même routerId : la vérification d'ownership doit
    // rejeter AVANT toute consultation du cache — le cache est un Map process
    // global par routerId, pas par tenant, donc c'est la SEULE barrière.
    await expect(asTenant('tenant-a', () => controller.live(ROUTER_B.id))).rejects.toThrow(NotFoundException);

    // 3) Le propriétaire légitime continue de recevoir le snapshot en cache (HIT),
    // sans nouvelle lecture RouterOS déclenchée par la tentative de tenant A.
    const again = await asTenant('tenant-b', () => controller.live(ROUTER_B.id));
    expect(again.cpuPercent).toBe(10);
    expect(mockRemote.run).toHaveBeenCalledTimes(1); // toujours 1 : la tentative de A n'a lu ni caché ni RouterOS
  });

  it('routeur inexistant (quel que soit le tenant) : 404, jamais un cache vide construit à sa place', async () => {
    const prisma = fakePrisma([]);
    const gateway = new RouterGatewayService(mockRemote as never, new RouterLiveEventsService());
    const controller = new RouterLiveController(gateway, prisma as never);

    await expect(asTenant('tenant-a', () => controller.live('does-not-exist'))).rejects.toThrow(NotFoundException);
    expect(mockRemote.run).not.toHaveBeenCalled();
  });
});
