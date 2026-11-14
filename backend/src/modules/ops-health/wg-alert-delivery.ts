import type { EmailDeliveryResult, MailSendResult } from '../mail/mail.service';
import type { PushDeliveryResult } from '../notifications/notifications.service';

export type { EmailDeliveryResult, PushDeliveryResult };

export { entityRef as deliveryEntityRef } from '../../common/utils/entity-ref';

/**
 * `SENT` (e-mail) = accepté par le transport SMTP ; `SENT` (push) = accepté par l'API Expo.
 * Ni l'un ni l'autre ne prouve la remise en boîte, la lecture ou l'affichage sur le téléphone :
 * « livré à l'utilisateur » est réservé à une future preuve de réception.
 */
export interface WgAlertDeliveryOutcome {
  email: EmailDeliveryResult;
  push: PushDeliveryResult;
  /** Vrai si au moins un fournisseur (SMTP ou Expo) a accepté le message. Affichage : « accepté par un canal ». */
  providerAccepted: boolean;
  attemptedAt: Date;
  failureCodes: string[];
}

export function combineEmailResults(results: MailSendResult[]): { status: EmailDeliveryResult; failureCodes: string[] } {
  if (!results.length) return { status: 'NO_RECIPIENT', failureCodes: [] };
  const failureCodes = [...new Set(results.flatMap((r) => (r.failureCode ? [r.failureCode] : [])))];
  if (results.some((r) => r.status === 'SENT')) return { status: 'SENT', failureCodes };
  if (results.some((r) => r.status === 'FAILED')) return { status: 'FAILED', failureCodes };
  if (results.some((r) => r.status === 'NOT_CONFIGURED')) return { status: 'NOT_CONFIGURED', failureCodes };
  return { status: 'NO_RECIPIENT', failureCodes };
}

export function buildDeliveryOutcome(
  email: EmailDeliveryResult,
  push: PushDeliveryResult,
  failureCodes: string[],
  attemptedAt: Date,
): WgAlertDeliveryOutcome {
  const codes = [...new Set(failureCodes)];
  if (email === 'NO_RECIPIENT') codes.push('EMAIL_NO_RECIPIENT');
  if (email === 'NOT_CONFIGURED') codes.push('SMTP_NOT_CONFIGURED');
  if (push === 'NO_TOKEN') codes.push('PUSH_NO_TOKEN');
  if (push === 'DISABLED') codes.push('PUSH_DISABLED');
  return { email, push, providerAccepted: email === 'SENT' || push === 'SENT', attemptedAt, failureCodes: [...new Set(codes)] };
}
