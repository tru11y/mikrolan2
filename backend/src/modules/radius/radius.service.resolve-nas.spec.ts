import { RadiusService } from './radius.service';
import type { AuthorizeDto } from './dto/radius.schemas';

/**
 * Régression sécu : resolveNas choisit le tenant UNIQUEMENT via l'IP source du
 * paquet (NAS-IP-Address = %{Packet-Src-IP-Address}, authentifiée par
 * FreeRADIUS), jamais via un attribut client (NAS-Identifier). Sinon : bypass
 * d'isolation cross-tenant.
 */
describe('RadiusService.resolveNas', () => {
  const remotePeerFindFirst = jest.fn();
  const routerFindMany = jest.fn();
  const mockPrisma: Record<string, any> = {
    remotePeer: { findFirst: remotePeerFindFirst },
    router: { findMany: routerFindMany },
  };

  function buildService(): RadiusService {
    return new RadiusService(
      mockPrisma as any,
      { publish: jest.fn() } as any,
      { sendPushToTenant: jest.fn() } as any,
      { get: jest.fn() } as any,
      { disconnectVoucherEverywhere: jest.fn() } as any,
      { warning: jest.fn() } as any,
    );
  }

  beforeEach(() => {
    remotePeerFindFirst.mockReset();
    routerFindMany.mockReset();
    routerFindMany.mockResolvedValue([]);
  });

  it('résout le tenant via le peer WireGuard (IP source du paquet)', async () => {
    remotePeerFindFirst.mockResolvedValue({ routerId: 'r-victim', tenantId: 't-victim' });
    const dto = { 'NAS-IP-Address': '10.20.0.2' } as AuthorizeDto;

    await expect(buildService().resolveNas(dto)).resolves.toEqual({
      routerId: 'r-victim',
      tenantId: 't-victim',
    });
    expect(remotePeerFindFirst).toHaveBeenCalledWith({
      where: { wgIp: '10.20.0.2' },
      select: { routerId: true, tenantId: true },
    });
  });

  it('IGNORE NAS-Identifier : pas de sélection de tenant par attribut client', async () => {
    remotePeerFindFirst.mockResolvedValue(null);
    const dto = { 'NAS-Identifier': 'victim-router-identity' } as AuthorizeDto;

    await expect(buildService().resolveNas(dto)).resolves.toBeNull();
    // Aucune résolution par identity/attribut client.
    expect(routerFindMany).not.toHaveBeenCalled();
    expect(remotePeerFindFirst).not.toHaveBeenCalled();
  });

  it('fail-closed sans IP source', async () => {
    await expect(buildService().resolveNas({} as AuthorizeDto)).resolves.toBeNull();
  });
});
