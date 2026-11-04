import { HttpStatus, Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../../common/crypto/crypto.service';
import { BusinessException } from '../../common/exceptions/business.exception';
import { ErrorCode } from '../../common/error-codes';
import { generateTotpSecret, otpauthUrl, verifyTotp } from './totp';

interface MfaUser {
  totpSecretEnc: string | null;
  totpEnabledAt: Date | null;
}

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** Appelé après validation du mot de passe / de l'identité OAuth. */
  assertLogin(user: MfaUser, code?: string): void {
    if (!user.totpEnabledAt || !user.totpSecretEnc) return;
    if (!code) {
      throw new BusinessException(HttpStatus.UNAUTHORIZED, ErrorCode.AUTH_MFA_REQUIRED, 'Code de vérification requis.');
    }
    if (!verifyTotp(this.crypto.decrypt(user.totpSecretEnc), code)) {
      throw new BusinessException(HttpStatus.UNAUTHORIZED, ErrorCode.AUTH_MFA_INVALID, 'Code de vérification invalide.');
    }
  }

  async setup(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user) throw new BusinessException(HttpStatus.UNAUTHORIZED, ErrorCode.AUTH_ACCOUNT_NOT_FOUND, 'Compte introuvable.');
    if (user.totpEnabledAt) {
      throw new BusinessException(HttpStatus.CONFLICT, ErrorCode.AUTH_MFA_ALREADY_ENABLED, 'La MFA est déjà activée.');
    }
    const secret = generateTotpSecret();
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecretEnc: this.crypto.encrypt(secret) },
    });
    return { secret, otpauthUrl: otpauthUrl(secret, user.email) };
  }

  async enable(userId: string, code: string): Promise<{ enabled: true }> {
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user?.totpSecretEnc || user.totpEnabledAt) {
      throw new BusinessException(HttpStatus.CONFLICT, ErrorCode.AUTH_MFA_NOT_PENDING, 'Aucune activation MFA en cours.');
    }
    if (!verifyTotp(this.crypto.decrypt(user.totpSecretEnc), code)) {
      throw new BusinessException(HttpStatus.UNAUTHORIZED, ErrorCode.AUTH_MFA_INVALID, 'Code de vérification invalide.');
    }
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { totpEnabledAt: new Date() } }),
      // Les sessions existantes ont été ouvertes sans second facteur.
      this.prisma.refreshToken.updateMany({ where: { userId, revoked: false }, data: { revoked: true } }),
    ]);
    return { enabled: true };
  }

  async disable(userId: string, password: string | undefined, code: string): Promise<{ enabled: false }> {
    const user = await this.prisma.user.findFirst({ where: { id: userId } });
    if (!user?.totpEnabledAt || !user.totpSecretEnc) {
      throw new BusinessException(HttpStatus.CONFLICT, ErrorCode.AUTH_MFA_NOT_PENDING, "La MFA n'est pas activée.");
    }
    if (user.hasPassword) {
      if (!password || !(await argon2.verify(user.passwordHash, password))) {
        throw new BusinessException(HttpStatus.UNAUTHORIZED, ErrorCode.AUTH_WRONG_PASSWORD, 'Mot de passe incorrect');
      }
    }
    this.assertLogin(user, code);
    await this.prisma.user.update({
      where: { id: userId },
      data: { totpSecretEnc: null, totpEnabledAt: null },
    });
    return { enabled: false };
  }
}
