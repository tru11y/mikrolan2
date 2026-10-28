import { Injectable, Logger, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BusinessException } from '../../../common/exceptions/business.exception';
import { ErrorCode } from '../../../common/error-codes';
import type { AppConfig } from '../../../config/configuration';

/**
 * Wrapper HTTP minimal pour l'API SasPay.
 *
 * Isolé dans sa propre classe pour pouvoir le mocker à l'unité sans toucher
 * au service métier. N'écrit JAMAIS en clair la clé API dans les logs, et
 * n'expose jamais le payload de réponse brut (seulement les champs utiles).
 */

export interface CreateCheckoutSessionRequest {
  amount: number;
  currency: string;
  country: string;
  networks: string[];
  feeChargeMode: 'ADD_ON' | 'DEDUCTED';
  successUrl: string;
  cancelUrl: string;
  reference: string;
  idempotencyKey: string;
  metadata: Record<string, string>;
}

export interface CreateCheckoutSessionResponse {
  id: string;
  checkoutUrl: string;
  expiresAt: Date | null;
}

@Injectable()
export class SaspayClient {
  private readonly logger = new Logger(SaspayClient.name);

  constructor(private readonly config: ConfigService<AppConfig, true>) {}

  private get baseUrl(): string {
    return this.config.get('SASPAY_BASE_URL', { infer: true });
  }

  private get apiKey(): string {
    return this.config.get('SASPAY_API_KEY', { infer: true });
  }

  async createCheckoutSession(
    req: CreateCheckoutSessionRequest,
  ): Promise<CreateCheckoutSessionResponse> {
    if (!this.apiKey) {
      throw new BusinessException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
        'Prestataire de paiement non configuré.',
      );
    }

    const body = {
      amount: req.amount,
      currency: req.currency,
      country: req.country,
      networks: req.networks,
      fee_charge_mode: req.feeChargeMode,
      success_url: req.successUrl,
      cancel_url: req.cancelUrl,
      reference: req.reference,
      metadata: req.metadata,
    };

    const url = `${this.baseUrl}/checkout-sessions/`;
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
          // POST /checkout-sessions/ ne supporte pas Idempotency-Key d'après
          // la doc SasPay — on l'inclut quand même par défense (ignoré côté
          // serveur), au cas où ils l'activeraient plus tard.
          'Idempotency-Key': req.idempotencyKey,
        },
        body: JSON.stringify(body),
        // 15s = marge au-delà du budget webhook SasPay (lui-même 15s)
        signal: AbortSignal.timeout(15_000),
      });
    } catch (err) {
      this.logger.error(`SasPay createCheckoutSession network error: ${(err as Error).message}`);
      throw new BusinessException(
        HttpStatus.BAD_GATEWAY,
        ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
        'Prestataire de paiement injoignable, réessayez.',
      );
    }

    const text = await res.text();
    if (!res.ok) {
      // On loggue le code HTTP et un extrait court — jamais la payload complète
      // ni les headers.
      this.logger.warn(`SasPay checkout session failed: HTTP ${res.status} ${text.slice(0, 200)}`);
      throw new BusinessException(
        HttpStatus.BAD_GATEWAY,
        ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
        'Création du paiement refusée par le prestataire.',
      );
    }

    let parsed: { success?: boolean; data?: { id?: string; checkout_url?: string; expires_at?: string } };
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new BusinessException(
        HttpStatus.BAD_GATEWAY,
        ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
        'Réponse invalide du prestataire.',
      );
    }

    const id = parsed?.data?.id;
    const checkoutUrl = parsed?.data?.checkout_url;
    if (!id || !checkoutUrl) {
      throw new BusinessException(
        HttpStatus.BAD_GATEWAY,
        ErrorCode.PAYMENT_PROVIDER_UNAVAILABLE,
        'Réponse incomplète du prestataire.',
      );
    }

    return {
      id,
      checkoutUrl,
      expiresAt: parsed.data?.expires_at ? new Date(parsed.data.expires_at) : null,
    };
  }
}
