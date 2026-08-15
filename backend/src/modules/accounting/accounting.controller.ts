import {
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Body,
} from '@nestjs/common';
import { AccountingService } from './accounting.service';

@Controller('accounting')
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get('revenue/by-period')
  revenueByPeriod(@Query('months') months?: string) {
    return this.accounting.revenueByPeriod(
      months ? Math.min(Number(months), 24) : 12,
    );
  }

  @Get('revenue/by-router')
  revenueByRouter(
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.accounting.revenueByRouter(from, to);
  }

  @Get('invoices')
  invoices(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.accounting.invoices(
      page ? Number(page) : 1,
      limit ? Math.min(Number(limit), 100) : 20,
    );
  }

  @Post('invoices/generate')
  @HttpCode(201)
  generateInvoice(
    @Body() body: { periodStart: string; periodEnd: string },
  ) {
    return this.accounting.generateInvoice(body.periodStart, body.periodEnd);
  }
}
