import { Module } from '@nestjs/common';
import { AppReleasesController } from './app-releases.controller';
import { AppReleasesService } from './app-releases.service';
import { ReleaseStorageService } from './release-storage.service';

@Module({
  controllers: [AppReleasesController],
  providers: [AppReleasesService, ReleaseStorageService],
})
export class AppReleasesModule {}
