import { Module } from '@nestjs/common';
import { AppReleasesController } from './app-releases.controller';
import { TenantReleasesController } from './tenant-releases.controller';
import { AppReleasesService } from './app-releases.service';
import { ReleasesPortalController } from './releases-portal.controller';
import { ReleaseStorageService } from './release-storage.service';
import { PublicDownloadController } from './public-download.controller';

@Module({
  controllers: [
    AppReleasesController,
    ReleasesPortalController,
    TenantReleasesController,
    PublicDownloadController,
  ],
  providers: [AppReleasesService, ReleaseStorageService],
})
export class AppReleasesModule {}
