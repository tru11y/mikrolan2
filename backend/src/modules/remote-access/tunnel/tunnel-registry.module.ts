import { Global, Module } from '@nestjs/common';
import { TunnelSessionRegistry } from './tunnel-session.registry';

/**
 * Le registre des sessions tunnel vivantes est un singleton process-wide : il
 * DOIT exister en un seul exemplaire (une seule Map pour toutes les sockets).
 * Module `@Global` → une seule instance partagée par tous les modules qui
 * coupent des sessions (remote-access, compliance, routers, admin) sans créer
 * d'arête d'import ni de cycle.
 */
@Global()
@Module({
  providers: [TunnelSessionRegistry],
  exports: [TunnelSessionRegistry],
})
export class TunnelRegistryModule {}
