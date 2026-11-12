import { Injectable } from '@nestjs/common';
import type { EmailDeliveryResult, MailSendResult } from '../mail/mail.service';
import type { PushDeliveryResult } from '../notifications/notifications.service';
import type { HealthLevel } from './ops-health.service';

export type { EmailDeliveryResult, PushDeliveryResult };

export interface WgAlertDeliveryOutcome {
  email: EmailDeliveryResult;
  push: PushDeliveryResult;
  /** Vrai uniquement si un e-mail a été accepté par le SMTP ou un push accepté par Expo. */
  humanDelivered: boolean;
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
  return { email, push, humanDelivered: email === 'SENT' || push === 'SENT', attemptedAt, failureCodes: [...new Set(codes)] };
}

const WINDOW_MS = 24 * 3_600_000;
const WARN_AFTER_MS = 15 * 60_000;
const RED_AFTER_MS = 3_600_000;
const MAX_EVENTS = 1000;

export interface WgAlertHealth {
  level: HealthLevel;
  /** Compteurs en mémoire du processus : remis à zéro au redémarrage (la persistance arrive avec AlertDelivery). */
  source: 'process-memory';
  since: string;
  windowHours: 24;
  wgAlertsCreated: number;
  wgDeliveryAttemptsEmail: number;
  wgDeliveryAttemptsPush: number;
  wgDeliveredEmail: number;
  wgDeliveredPush: number;
  wgUndelivered: number;
  wgNoRecipient: number;
  wgNoPushToken: number;
  wgInvalidPushToken: number;
  wgProviderFailures: number;
  wgOpenUndeliveredOver1h: number;
}

interface Event {
  at: number;
  outcome: WgAlertDeliveryOutcome;
}

/**
 * Preuve de livraison des alertes WireGuard, sans migration : aucune donnée sensible (ni adresse, ni token),
 * uniquement des statuts. Limite assumée : volatile (redémarrage = remise à zéro).
 */
@Injectable()
export class WgAlertDeliveryRegistry {
  private readonly startedAt = Date.now();
  private events: Event[] = [];
  private readonly openUndelivered = new Map<string, number>();

  record(peerId: string, outcome: WgAlertDeliveryOutcome, nowMs: number = Date.now()): void {
    this.events.push({ at: nowMs, outcome });
    if (this.events.length > MAX_EVENTS) this.events = this.events.slice(-MAX_EVENTS);
    if (outcome.humanDelivered) this.openUndelivered.delete(peerId);
    else if (!this.openUndelivered.has(peerId)) this.openUndelivered.set(peerId, nowMs);
  }

  /** Le tunnel a repris : l'incident n'est plus ouvert. */
  resolve(peerId: string): void {
    this.openUndelivered.delete(peerId);
  }

  snapshot(nowMs: number = Date.now()): WgAlertHealth {
    const ev = this.events.filter((e) => nowMs - e.at < WINDOW_MS).map((e) => e.outcome);
    const count = (fn: (o: WgAlertDeliveryOutcome) => boolean): number => ev.filter(fn).length;
    const ages = [...this.openUndelivered.values()].map((t) => nowMs - t);
    const over1h = ages.filter((a) => a >= RED_AFTER_MS).length;
    const delivered = count((o) => o.humanDelivered);

    let level: HealthLevel = 'GREEN';
    if (ages.some((a) => a >= WARN_AFTER_MS)) level = 'ORANGE';
    if (over1h > 0 || (ev.length > 0 && delivered === 0)) level = 'RED';

    return {
      level,
      source: 'process-memory',
      since: new Date(this.startedAt).toISOString(),
      windowHours: 24,
      wgAlertsCreated: ev.length,
      wgDeliveryAttemptsEmail: count((o) => o.email === 'SENT' || o.email === 'FAILED'),
      wgDeliveryAttemptsPush: count((o) => o.push === 'SENT' || o.push === 'FAILED' || o.push === 'INVALID_TOKEN'),
      wgDeliveredEmail: count((o) => o.email === 'SENT'),
      wgDeliveredPush: count((o) => o.push === 'SENT'),
      wgUndelivered: ev.length - delivered,
      wgNoRecipient: count((o) => o.email === 'NO_RECIPIENT'),
      wgNoPushToken: count((o) => o.push === 'NO_TOKEN'),
      wgInvalidPushToken: count((o) => o.push === 'INVALID_TOKEN'),
      wgProviderFailures: count((o) => o.email === 'FAILED') + count((o) => o.push === 'FAILED'),
      wgOpenUndeliveredOver1h: over1h,
    };
  }
}
