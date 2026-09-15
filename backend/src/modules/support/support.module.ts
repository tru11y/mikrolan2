import { Module } from '@nestjs/common';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { SupportSlaCron } from './support-sla.cron';

@Module({
  controllers: [SupportController],
  providers: [SupportService, SupportSlaCron],
  exports: [SupportService],
})
export class SupportModule {}
