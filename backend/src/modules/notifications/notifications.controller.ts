import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantContext } from '../../common/context/tenant-context';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationsService } from './notifications.service';
import {
  listNotificationsQuerySchema,
  type ListNotificationsQueryDto,
} from './dto/notifications.schemas';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(listNotificationsQuerySchema))
    query: ListNotificationsQueryDto,
  ) {
    return this.notifications.list(query);
  }

  @Get('unread-count')
  unreadCount() {
    return this.notifications.unreadCount().then((count) => ({ count }));
  }

  @Patch(':id/read')
  @HttpCode(200)
  markRead(@Param('id', ParseUUIDPipe) id: string) {
    return this.notifications.markRead(id);
  }

  @Patch('read-all')
  @HttpCode(200)
  markAllRead() {
    return this.notifications.markAllRead();
  }

  // TODO: TEMPORARY — remove after push testing
  @Post('test-push')
  @HttpCode(200)
  async testPush(@CurrentUser() user: TenantContext) {
    const u = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.userId },
      select: { pushToken: true },
    });
    if (!u.pushToken) return { error: 'No push token registered' };
    const res = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([{
        to: u.pushToken,
        title: 'Test MikroLan',
        body: 'Push notification de test',
        sound: 'default',
        channelId: 'default',
        priority: 'high',
      }]),
    });
    const data = await res.json();
    return { status: res.status, data };
  }
}
