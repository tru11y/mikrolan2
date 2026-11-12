import * as nodemailer from 'nodemailer';
import { MailService, SMTP_TIMEOUT_MS, maskEmail } from './mail.service';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

function build(host: string, sendMail?: jest.Mock): MailService {
  (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail });
  const values: Record<string, unknown> = {
    SMTP_HOST: host,
    SMTP_PORT: 587,
    SMTP_USER: 'u',
    SMTP_PASS: 'p',
    SMTP_FROM: 'MikroLan <noreply@example.test>',
  };
  return new MailService({ get: (k: string) => values[k] } as never);
}

describe('MailService — résultat explicite', () => {
  afterEach(() => jest.clearAllMocks());

  it('SMTP absent : NOT_CONFIGURED (pas SENT)', async () => {
    const mail = build('');
    await expect(mail.sendAlert('a@example.test', 'T', 'D')).resolves.toEqual({ status: 'NOT_CONFIGURED' });
  });

  it('destinataire vide : NO_RECIPIENT', async () => {
    const mail = build('smtp.example.test', jest.fn());
    await expect(mail.sendAlert('  ', 'T', 'D')).resolves.toEqual({ status: 'NO_RECIPIENT' });
  });

  it('transport accepté : SENT', async () => {
    const sendMail = jest.fn().mockResolvedValue({ accepted: ['a@example.test'], rejected: [] });
    const mail = build('smtp.example.test', sendMail);
    await expect(mail.sendAlert('a@example.test', 'T', 'D')).resolves.toEqual({ status: 'SENT' });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('message rejeté par le serveur (accepted vide) : FAILED REJECTED', async () => {
    const mail = build('smtp.example.test', jest.fn().mockResolvedValue({ accepted: [], rejected: ['a@example.test'] }));
    await expect(mail.sendAlert('a@example.test', 'T', 'D')).resolves.toEqual({ status: 'FAILED', failureCode: 'REJECTED' });
  });

  it('timeout SMTP : FAILED TIMEOUT, un seul essai', async () => {
    const sendMail = jest.fn().mockRejectedValue(Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' }));
    const mail = build('smtp.example.test', sendMail);
    await expect(mail.sendAlert('a@example.test', 'T', 'D')).resolves.toEqual({ status: 'FAILED', failureCode: 'TIMEOUT' });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('exception SMTP : FAILED SMTP_ERROR, ne lève pas', async () => {
    const mail = build('smtp.example.test', jest.fn().mockRejectedValue(new Error('550 mailbox a@example.test unavailable')));
    await expect(mail.sendAlert('a@example.test', 'T', 'D')).resolves.toEqual({ status: 'FAILED', failureCode: 'SMTP_ERROR' });
  });

  it('timeouts de transport explicites (10 s)', () => {
    build('smtp.example.test', jest.fn());
    expect(nodemailer.createTransport).toHaveBeenCalledWith(
      expect.objectContaining({ connectionTimeout: SMTP_TIMEOUT_MS, greetingTimeout: SMTP_TIMEOUT_MS, socketTimeout: SMTP_TIMEOUT_MS }),
    );
  });

  it('les logs ne contiennent jamais l adresse complète', async () => {
    const logs: string[] = [];
    const mail = build('smtp.example.test', jest.fn().mockRejectedValue(new Error('550 bob.secret@example.test refused')));
    const logger = (mail as unknown as { logger: { log: jest.Mock; error: jest.Mock } }).logger;
    jest.spyOn(logger, 'error').mockImplementation((m: unknown) => void logs.push(String(m)));
    jest.spyOn(logger, 'log').mockImplementation((m: unknown) => void logs.push(String(m)));
    await mail.sendAlert('bob.secret@example.test', 'T', 'D');
    expect(logs.join('\n')).not.toContain('bob.secret@example.test');
    expect(logs.join('\n')).toContain('b***@example.test');
  });

  it('maskEmail', () => {
    expect(maskEmail('alice@example.test')).toBe('a***@example.test');
    expect(maskEmail('invalide')).toBe('[email]');
  });
});
