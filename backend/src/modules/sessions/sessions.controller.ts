import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { SessionsService } from './sessions.service';

@Controller('routers/:id/sessions')
export class SessionsController {
  constructor(private readonly sessions: SessionsService) {}

  @Get()
  list(@Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.list(id);
  }

  @Post('sync')
  @HttpCode(200)
  sync(@Param('id', ParseUUIDPipe) id: string) {
    return this.sessions.sync(id);
  }

  @Post(':sessionId/terminate')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  terminate(@Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.sessions.terminate(sessionId);
  }
}
