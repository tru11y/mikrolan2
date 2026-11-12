import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { EmailDeliveryResult, MailSendResult } from '../mail/mail.service';
import type { PushDeliveryResult } from '../notifications/notifications.service';
import type { HealthLevel } from './ops-health.service';

export type { EmailDeliveryResult, PushDeliveryResult };

/**
 * Référence stable et non réversible d'une entité (tenant, peer) pour les logs et Sentry :
 * SHA-256 tronqué à 16 hex. Aucun identifiant brut ne doit sortir de l'application.
 */
export function deliveryEntityRef(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

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

const WINDOW_MS = 24 * 3_600_000;
const WARN_AFTER_MS = 15 * 60_000;
const RED_AFTER_MS = 3_600_000;
const MAX_EVENTS = 1000;

export interface WgAlertHealth {
  level: HealthLevel;
  persistence: 'MEMORY_ONLY';
  /** Démarrage du registre : les compteurs ne couvrent PAS l'historique avant cette date. */
  since: string;
  resetOnRestart: true;
  deliveryProofDurable: false;
  wgDeliveryRegistryStartedAt: string;
  wgDeliveryProofDurable: false;
  /** Peers avec `staleAlertedAt` mais sans aucune preuve mémoire depuis le démarrage : livraison inconnue. */
  wgUnknownDeliveryAfterRestart: number;
  /** Première passe du cron pas encore terminée depuis le démarrage : l'état réel est inconnu. */
  scanPending: boolean;
  message: string | null;
  windowHours: 24;
  wgAlertsCreated: number;
  wgDeliveryAttemptsEmail: number;
  wgDeliveryAttemptsPush: number;
  /** Alertes dont l'e-mail a été accepté par le transport SMTP (pas une preuve de remise en boîte ni de lecture). */
  wgEmailProviderAccepted: number;
  /** Alertes dont le push a été accepté par l'API Expo (pas une preuve d'affichage sur le téléphone). */
  wgPushProviderAccepted: number;
  /** Alertes pour lesquelles aucun fournisseur (SMTP, Expo) n'a accepté le message. */
  wgNoProviderAccepted: number;
  wgNoRecipient: number;
  wgNoPushToken: number;
  wgInvalidPushToken: number;
  wgProviderFailures: number;
  wgOpenNoProviderAcceptedOver1h: number;
  /** Codes d'échec distincts (jamais d'adresse, de token ni d'identifiant) des alertes de la fenêtre. */
  recentFailureCodes: string[];
}

interface Event {
  at: number;
  outcome: WgAlertDeliveryOutcome;
}

/**
 * Suivi des alertes WireGuard, sans migration : aucune donnée sensible (ni adresse, ni token, ni identifiant brut).
 * VOLATILE : un redémarrage remet tout à zéro. Après redémarrage, un peer qui porte `staleAlertedAt` sans preuve
 * en mémoire est `UNKNOWN_DELIVERY` (niveau ORANGE minimum) : on ne le déclare jamais accepté ni sain.
 */
@Injectable()
export class WgAlertDeliveryRegistry {
  private readonly startedAt = Date.now();
  private events: Event[] = [];
  private readonly openUndelivered = new Map<string, number>();
  private readonly known = new Set<string>();
  private readonly unknown = new Set<string>();
  private scanned = false;

  record(peerId: string, outcome: WgAlertDeliveryOutcome, nowMs: number = Date.now()): void {
    this.events.push({ at: nowMs, outcome });
    if (this.events.length > MAX_EVENTS) this.events = this.events.slice(-MAX_EVENTS);
    this.known.add(peerId);
    this.unknown.delete(peerId);
    if (outcome.providerAccepted) this.openUndelivered.delete(peerId);
    else if (!this.openUndelivered.has(peerId)) this.openUndelivered.set(peerId, nowMs);
  }

  /** Un peer a déjà `staleAlertedAt` : sans preuve mémoire correspondante, sa livraison est inconnue. */
  observeAlerted(peerId: string): void {
    if (!this.known.has(peerId)) this.unknown.add(peerId);
  }

  /** Le tunnel a repris : l'incident n'est plus ouvert. */
  resolve(peerId: string): void {
    this.openUndelivered.delete(peerId);
    this.unknown.delete(peerId);
    this.known.delete(peerId);
  }

  /** Fin d'une passe complète du cron (les peers en incident ont tous été observés). */
  markScanned(): void {
    this.scanned = true;
  }

  snapshot(nowMs: number = Date.now()): WgAlertHealth {
    const ev = this.events.filter((e) => nowMs - e.at < WINDOW_MS).map((e) => e.outcome);
    const count = (fn: (o: WgAlertDeliveryOutcome) => boolean): number => ev.filter(fn).length;
    const ages = [...this.openUndelivered.values()].map((t) => nowMs - t);
    const over1h = ages.filter((a) => a >= RED_AFTER_MS).length;
    const accepted = count((o) => o.providerAccepted);
    const unknown = this.unknown.size;

    let level: HealthLevel = 'GREEN';
    if (ages.some((a) => a >= WARN_AFTER_MS) || unknown > 0 || !this.scanned) level = 'ORANGE';
    if (over1h > 0 || (ev.length > 0 && accepted === 0)) level = 'RED';

    const startedIso = new Date(this.startedAt).toISOString();
    return {
      level,
      persistence: 'MEMORY_ONLY',
      since: startedIso,
      resetOnRestart: true,
      deliveryProofDurable: false,
      wgDeliveryRegistryStartedAt: startedIso,
      wgDeliveryProofDurable: false,
      wgUnknownDeliveryAfterRestart: unknown,
      scanPending: !this.scanned,
      message: unknown > 0 ? 'livraison inconnue après redémarrage' : !this.scanned ? 'analyse des incidents en attente après redémarrage' : null,
      windowHours: 24,
      wgAlertsCreated: ev.length,
      wgDeliveryAttemptsEmail: count((o) => o.email === 'SENT' || o.email === 'FAILED'),
      wgDeliveryAttemptsPush: count((o) => o.push === 'SENT' || o.push === 'FAILED' || o.push === 'INVALID_TOKEN'),
      wgEmailProviderAccepted: count((o) => o.email === 'SENT'),
      wgPushProviderAccepted: count((o) => o.push === 'SENT'),
      wgNoProviderAccepted: ev.length - accepted,
      wgNoRecipient: count((o) => o.email === 'NO_RECIPIENT'),
      wgNoPushToken: count((o) => o.push === 'NO_TOKEN'),
      wgInvalidPushToken: count((o) => o.push === 'INVALID_TOKEN'),
      wgProviderFailures: count((o) => o.email === 'FAILED') + count((o) => o.push === 'FAILED'),
      wgOpenNoProviderAcceptedOver1h: over1h,
      recentFailureCodes: [...new Set(ev.flatMap((o) => o.failureCodes))].sort(),
    };
  }
}
