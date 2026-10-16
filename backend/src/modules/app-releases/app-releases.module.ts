import { Module } from '@nestjs/common';
import { AppReleasesController } from './app-releases.controller';
import { AppReleasesService } from './app-releases.service';
import { ReleasesPortalController } from './releases-portal.controller';
import { ReleaseStorageService } from './release-storage.service';

@Module({
  controllers: [AppReleasesController, ReleasesPortalController],
  providers: [AppReleasesService, ReleaseStorageService],
})
export class AppReleasesModule {}
