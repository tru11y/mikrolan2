import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { NotificationsService } from './notifications.service';
import {
  listNotificationsQuerySchema,
  type ListNotificationsQueryDto,
} from './dto/notifications.schemas';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

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
}
