import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { TenantContext } from '../../common/context/tenant-context';
import { AlwaysAllowed } from '../../common/decorators/always-allowed.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AppReleasesService } from './app-releases.service';

/**
 * Portail de téléchargement APK côté tenant : tout utilisateur authentifié.
 * Reste accessible à un tenant verrouillé par le paywall (mise à jour de l'app).
 */
@Controller('releases')
@AlwaysAllowed()
export class TenantReleasesController {
  constructor(private readonly releases: AppReleasesService) {}

  @Get('latest')
  latest() {
    return this.releases.latestForTenant();
  }

  @Get('history')
  history() {
    return this.releases.history();
  }

  @Post(':id/download-log')
  @HttpCode(201)
  downloadLog(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: TenantContext) {
    return this.releases.logDownload(id, actor);
  }
}
