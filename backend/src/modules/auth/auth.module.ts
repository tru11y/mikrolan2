import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';

@Module({
  imports: [JwtModule.register({}), SubscriptionsModule],
  controllers: [AuthController],
  providers: [AuthService, TokenService],
})
export class AuthModule {}
