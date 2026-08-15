import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { AppConfig } from '../../config/configuration';

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(private readonly config: ConfigService<AppConfig, true>) {
    const host = config.get('SMTP_HOST', { infer: true });
    this.from = config.get('SMTP_FROM', { infer: true });

    if (host) {
      this.transporter = nodemailer.createTransport({
        host,
        port: config.get('SMTP_PORT', { infer: true }),
        secure: false,
        auth: {
          user: config.get('SMTP_USER', { infer: true }),
          pass: config.get('SMTP_PASS', { infer: true }),
        },
      });
      this.logger.log(`SMTP configured via ${host}`);
    } else {
      this.transporter = null;
      this.logger.warn('SMTP not configured — emails disabled');
    }
  }

  async sendWelcome(to: string, tenantName: string): Promise<void> {
    await this.send(to, 'Bienvenue sur MikroLan', welcomeHtml(tenantName));
  }

  async sendPasswordReset(to: string, code: string, expiresMinutes: number): Promise<void> {
    await this.send(to, 'Réinitialisation de mot de passe', resetHtml(code, expiresMinutes));
  }

  async sendRouterOffline(to: string, routerName: string): Promise<void> {
    await this.send(to, `Routeur ${routerName} hors ligne`, routerOfflineHtml(routerName));
  }

  async sendInvoice(to: string, invoiceId: string, amount: number, period: string): Promise<void> {
    await this.send(to, `Facture MikroLan — ${period}`, invoiceHtml(invoiceId, amount, period));
  }

  private async send(to: string, subject: string, html: string): Promise<void> {
    if (!this.transporter) {
      this.logger.debug(`Mail skipped (no SMTP): ${subject} → ${to}`);
      return;
    }
    try {
      await this.transporter.sendMail({ from: this.from, to, subject, html });
      this.logger.log(`Mail sent: ${subject} → ${to}`);
    } catch (err) {
      this.logger.error(`Mail failed: ${subject} → ${to}`, (err as Error).stack);
    }
  }
}

function welcomeHtml(tenantName: string): string {
  return `
    <h2>Bienvenue sur MikroLan, ${esc(tenantName)} !</h2>
    <p>Votre espace est prêt. Connectez vos routeurs MikroTik et commencez à vendre du WiFi.</p>
    <p>Si vous avez la moindre question, répondez directement à cet email.</p>
    <p>— L'équipe MikroLan</p>
  `;
}

function resetHtml(code: string, minutes: number): string {
  return `
    <h2>Réinitialisation de mot de passe</h2>
    <p>Votre code de vérification :</p>
    <h1 style="letter-spacing:4px;font-family:monospace">${esc(code)}</h1>
    <p>Ce code expire dans ${minutes} minutes.</p>
    <p>Si vous n'avez pas demandé cette réinitialisation, ignorez cet email.</p>
  `;
}

function routerOfflineHtml(name: string): string {
  return `
    <h2>Routeur hors ligne</h2>
    <p>Le routeur <strong>${esc(name)}</strong> ne répond plus depuis quelques minutes.</p>
    <p>Vérifiez l'alimentation et la connexion internet du routeur.</p>
  `;
}

function invoiceHtml(id: string, amount: number, period: string): string {
  return `
    <h2>Facture MikroLan</h2>
    <p>Facture <strong>#${esc(id)}</strong> pour la période <strong>${esc(period)}</strong>.</p>
    <p>Montant : <strong>${amount.toLocaleString('fr-FR')} XOF</strong></p>
    <p>Consultez le détail dans votre espace MikroLan.</p>
  `;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
