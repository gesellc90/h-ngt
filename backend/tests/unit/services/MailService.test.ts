/**
 * Unit-Tests für MailService — Retry-Verhalten, Passwort-Maskierung und den
 * MAIL_ENABLED=false-Kurzschluss. nodemailer wird komplett gemockt: es geht
 * in keinem Test eine echte Mail raus.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import pino from 'pino';
import { MailService } from '../../../src/services/MailService.js';
import { AppError } from '../../../src/middleware/errorHandler.js';

const sendMail = vi.fn();
const verify = vi.fn();

vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({ sendMail, verify }),
  },
}));

const silentLogger = pino({ level: 'silent' });

function makeService(overrides: Partial<{ enabled: boolean }> = {}): MailService {
  return new MailService(
    {
      enabled: overrides.enabled ?? true,
      host: 'sslout.df.eu',
      port: 465,
      secure: true,
      user: 'bierwart-app@nassovia.de',
      pass: 'geheimes-passwort',
      from: 'bierwart-app@nassovia.de',
      retries: 2,
      retryDelayMs: 1, // Tests sollen nicht künstlich warten müssen
    },
    silentLogger,
  );
}

beforeEach(() => {
  sendMail.mockReset();
  verify.mockReset();
});

describe('MailService.send', () => {
  it('liefert ok:false ohne SMTP-Aufruf, wenn MAIL_ENABLED=false', async () => {
    const service = makeService({ enabled: false });
    const result = await service.send({ to: 'a@b.de', subject: 'x', text: 'y' });
    expect(result.ok).toBe(false);
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('gibt bei Erfolg die messageId zurück', async () => {
    sendMail.mockResolvedValueOnce({ messageId: '<abc@df.eu>' });
    const service = makeService();
    const result = await service.send({ to: 'a@b.de', subject: 'x', text: 'y' });
    expect(result).toEqual({ ok: true, messageId: '<abc@df.eu>' });
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  it('versucht bei einem transienten Fehler erneut und gibt beim zweiten Versuch Erfolg zurück', async () => {
    sendMail.mockRejectedValueOnce(new Error('Connection timeout')).mockResolvedValueOnce({
      messageId: '<retry@df.eu>',
    });
    const service = makeService();
    const result = await service.send({ to: 'a@b.de', subject: 'x', text: 'y' });
    expect(result).toEqual({ ok: true, messageId: '<retry@df.eu>' });
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('gibt nach Ausschöpfen aller Versuche ok:false mit Fehlermeldung zurück', async () => {
    sendMail.mockRejectedValue(new Error('535 Authentication failed'));
    const service = makeService();
    const result = await service.send({ to: 'a@b.de', subject: 'x', text: 'y' });
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Authentication failed');
    expect(sendMail).toHaveBeenCalledTimes(2);
  });

  it('maskiert das SMTP-Passwort, falls es in der Fehlermeldung auftaucht', async () => {
    sendMail.mockRejectedValue(new Error('auth failed for geheimes-passwort'));
    const service = makeService();
    const result = await service.send({ to: 'a@b.de', subject: 'x', text: 'y' });
    expect(result.error).not.toContain('geheimes-passwort');
    expect(result.error).toContain('***');
  });
});

describe('MailService.verify', () => {
  it('wirft AppError(503), wenn MAIL_ENABLED=false', async () => {
    const service = makeService({ enabled: false });
    await expect(service.verify()).rejects.toThrow(AppError);
    await expect(service.verify()).rejects.toMatchObject({ statusCode: 503 });
  });

  it('wirft AppError(502) bei fehlgeschlagener SMTP-Verbindung', async () => {
    verify.mockRejectedValue(new Error('ECONNREFUSED'));
    const service = makeService();
    await expect(service.verify()).rejects.toMatchObject({ statusCode: 502 });
  });

  it('löst erfolgreich auf, wenn die SMTP-Verbindung steht', async () => {
    verify.mockResolvedValue(true);
    const service = makeService();
    await expect(service.verify()).resolves.toBeUndefined();
  });
});
