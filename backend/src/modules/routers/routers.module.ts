import { Module } from '@nestjs/common';
import { RoutersController } from './routers.controller';
import { RoutersService } from './routers.service';

@Module({
  controllers: [RoutersController],
  providers: [RoutersService],
})
export class RoutersModule {}
