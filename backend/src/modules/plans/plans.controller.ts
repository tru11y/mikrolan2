import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { PlansService } from './plans.service';
import {
  createPlanSchema,
  updatePlanSchema,
  type CreatePlanDto,
  type UpdatePlanDto,
} from './dto/plan.schemas';

// Plans are scoped to a router: each router owns its own catalogue de forfaits.
@Controller('routers/:routerId/plans')
export class PlansController {
  constructor(private readonly plans: PlansService) {}

  @Get()
  findAll(@Param('routerId', ParseUUIDPipe) routerId: string) {
    return this.plans.findAll(routerId);
  }

  @Get(':id')
  findOne(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.plans.findOne(routerId, id);
  }

  @Post()
  @Roles(UserRole.ADMIN)
  create(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Body(new ZodValidationPipe(createPlanSchema)) dto: CreatePlanDto,
  ) {
    return this.plans.create(routerId, dto);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  update(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updatePlanSchema)) dto: UpdatePlanDto,
  ) {
    return this.plans.update(routerId, id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  remove(
    @Param('routerId', ParseUUIDPipe) routerId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.plans.remove(routerId, id);
  }
}
