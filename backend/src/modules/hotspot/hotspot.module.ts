import { Module } from '@nestjs/common';
import { HotspotController } from './hotspot.controller';
import { HotspotService } from './hotspot.service';
import { RemoteAccessModule } from '../remote-access/remote-access.module';

@Module({
  imports: [RemoteAccessModule],
  controllers: [HotspotController],
  providers: [HotspotService],
})
export class HotspotModule {}
