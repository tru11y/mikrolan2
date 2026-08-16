import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { AlwaysAllowed } from '../../common/decorators/always-allowed.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TenantContext } from '../../common/context/tenant-context';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';
import {
  changePasswordSchema,
  confirmPasswordResetSchema,
  deleteAccountSchema,
  googleOAuthSchema,
  loginSchema,
  refreshSchema,
  registerPushTokenSchema,
  requestPasswordResetSchema,
  setPasswordSchema,
  signupSchema,
  updateNotificationsSchema,
  updateProfileSchema,
  type ChangePasswordDto,
  type ConfirmPasswordResetDto,
  type DeleteAccountDto,
  type GoogleOAuthDto,
  type LoginDto,
  type RefreshDto,
  type RegisterPushTokenDto,
  type RequestPasswordResetDto,
  type SetPasswordDto,
  type SignupDto,
  type UpdateNotificationsDto,
  type UpdateProfileDto,
} from './dto/auth.schemas';

@Controller('auth')
@AlwaysAllowed() // se connecter et consulter son compte restent possibles
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('signup')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  signup(@Body(new ZodValidationPipe(signupSchema)) dto: SignupDto) {
    return this.auth.signup(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  login(@Body(new ZodValidationPipe(loginSchema)) dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(@Body(new ZodValidationPipe(refreshSchema)) dto: RefreshDto) {
    return this.auth.refresh(dto.refreshToken);
  }

  @Get('me')
  me(@CurrentUser() user: TenantContext) {
    return this.auth.me(user.userId, user.tenantId);
  }

  @Patch('me')
  updateProfile(
    @CurrentUser() user: TenantContext,
    @Body(new ZodValidationPipe(updateProfileSchema)) dto: UpdateProfileDto,
  ) {
    return this.auth.updateProfile(user.userId, dto);
  }

  @Post('change-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  changePassword(
    @CurrentUser() user: TenantContext,
    @Body(new ZodValidationPipe(changePasswordSchema)) dto: ChangePasswordDto,
  ) {
    return this.auth.changePassword(user.userId, dto);
  }

  @Post('set-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  setPassword(
    @CurrentUser() user: TenantContext,
    @Body(new ZodValidationPipe(setPasswordSchema)) dto: SetPasswordDto,
  ) {
    return this.auth.setPassword(user.userId, dto);
  }

  @Public()
  @Post('password-reset/request')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  requestPasswordReset(
    @Body(new ZodValidationPipe(requestPasswordResetSchema)) dto: RequestPasswordResetDto,
  ) {
    return this.auth.requestPasswordReset(dto);
  }

  @Public()
  @Post('password-reset/confirm')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  confirmPasswordReset(
    @Body(new ZodValidationPipe(confirmPasswordResetSchema)) dto: ConfirmPasswordResetDto,
  ) {
    return this.auth.confirmPasswordReset(dto);
  }

  @Public()
  @Post('google')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  googleLogin(@Body(new ZodValidationPipe(googleOAuthSchema)) dto: GoogleOAuthDto) {
    return this.auth.googleLogin(dto.idToken, dto.nonce);
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Body(new ZodValidationPipe(refreshSchema)) dto: RefreshDto) {
    return this.auth.logout(dto.refreshToken);
  }

  @Patch('me/notifications')
  updateNotifications(
    @CurrentUser() user: TenantContext,
    @Body(new ZodValidationPipe(updateNotificationsSchema))
    dto: UpdateNotificationsDto,
  ) {
    return this.auth.updateNotifications(user.userId, dto);
  }

  @Post('push-token')
  @HttpCode(200)
  registerPushToken(
    @CurrentUser() user: TenantContext,
    @Body(new ZodValidationPipe(registerPushTokenSchema))
    dto: RegisterPushTokenDto,
  ) {
    return this.auth.registerPushToken(user.userId, dto.token);
  }

  @Post('logout-all')
  @HttpCode(200)
  logoutAll(@CurrentUser() user: TenantContext) {
    return this.auth.revokeAllSessions(user.userId);
  }

  @Delete('me')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  deleteAccount(
    @CurrentUser() user: TenantContext,
    @Body(new ZodValidationPipe(deleteAccountSchema)) dto: DeleteAccountDto,
  ) {
    return this.auth.deleteAccount(user.userId, dto);
  }
}
