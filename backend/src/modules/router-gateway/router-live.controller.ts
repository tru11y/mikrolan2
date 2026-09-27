import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RouterGatewayService } from './router-gateway.service';
import type { SnapshotWant } from './router-gateway.types';

/**
 * Endpoint additif (Phase 1) : snapshot enrichi (stale/ageMs/refreshing/lastError)
 * pour un futur écran mobile. N'existait pas avant #P0-RG et ne remplace aucune
 * route existante — `remote/system-resource` et `sessions` (legacy) restent
 * inchangés et continuent de fonctionner indépendamment de ce contrôleur.
 */
@Controller('routers/:id/remote')
export class RouterLiveController {
  constructor(
    private readonly gateway: RouterGatewayService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('live')
  async live(@Param('id', ParseUUIDPipe) id: string, @Query('want') want?: SnapshotWant) {
    // Le cache du Gateway est un `Map` global process (par routerId, pas par
    // tenant) : contrairement à `remote.run()` (appelé sur un MISS), une lecture
    // servie en cache (HIT) ne repasse jamais par le middleware Prisma qui scope
    // par tenant. Cette vérification est donc obligatoire à CHAQUE requête, y
    // compris en HIT — jamais déléguée au cache.
    const router = await this.prisma.router.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!router) throw new NotFoundException('Routeur introuvable');
    return this.gateway.getLiveSnapshot(id, want ?? 'stats');
  }
}
