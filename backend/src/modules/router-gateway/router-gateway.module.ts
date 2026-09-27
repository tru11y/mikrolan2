import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { RemoteAccessModule } from '../remote-access/remote-access.module';
import { RouterGatewayService } from './router-gateway.service';
import { RouterLiveEventsService } from './router-live-events.service';
import { RouterLiveEventsController } from './router-live-events.controller';
import { RouterLiveController } from './router-live.controller';

@Module({
  imports: [PrismaModule, RemoteAccessModule],
  controllers: [RouterLiveEventsController, RouterLiveController],
  providers: [RouterGatewayService, RouterLiveEventsService],
  exports: [RouterGatewayService],
})
export class RouterGatewayModule {}
