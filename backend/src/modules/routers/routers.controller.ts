import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { UserRole } from '@prisma/client';
import { RoutersService } from './routers.service';
import {
  createRouterSchema,
  updateRouterSchema,
  type CreateRouterDto,
  type UpdateRouterDto,
} from './dto/router.schemas';

@Controller('routers')
export class RoutersController {
  constructor(private readonly routers: RoutersService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  create(@Body(new ZodValidationPipe(createRouterSchema)) dto: CreateRouterDto) {
    return this.routers.create(dto);
  }

  @Get()
  findAll() {
    return this.routers.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.routers.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateRouterSchema)) dto: UpdateRouterDto,
  ) {
    return this.routers.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @HttpCode(200)
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.routers.remove(id);
  }
}
