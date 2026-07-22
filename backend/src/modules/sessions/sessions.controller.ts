import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { SessionsService } from './sessions.service';
import {
  terminateSessionSchema,
  type TerminateSessionDto,
} from './dto/session.schemas';

@Controller('routers/:id/sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  live(@Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.live(id);
  }

  @Post('terminate')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  terminate(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(terminateSessionSchema)) dto: TerminateSessionDto,
  ) {
    return this.sessions.terminate(id, dto.mikrotikId);
  }
}
