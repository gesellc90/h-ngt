import nodemailer, { type Transporter } from 'nodemailer';
import type { Logger } from 'pino';
import { AppError } from '../middleware/errorHandler.js';

// ---------------------------------------------------------------------------
// MailService — dünner nodemailer-Wrapper (M15).
//
// Zuständig ausschließlich für den technischen Versand (SMTP-Verbindung,
// Retry, Dry-Run). Was versendet wird (Empfänger, Text, Anhänge) entscheidet
// BillingMailService — dieser Service kennt keine Abrechnungslogik.
//
// SMTP_PASS wird nie geloggt und nie in einer Fehlermeldung zurückgegeben:
// `send()` maskiert es defensiv, falls es (z. B. bei einem falsch
// formatierten Connection-String) in einer nodemailer-Fehlermeldung auftaucht.
// ---------------------------------------------------------------------------

export interface MailAttachment {
  filename: string;
  content: Buffer;
  contentType: string;
}

export interface MailMessage {
  to: string;
  cc?: string[];
  subject: string;
  text: string;
  attachments?: MailAttachment[];
}

export interface MailSendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
}

export interface MailServiceOptions {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  /** Anzahl Versuche bei transientem Fehler (Timeout, Verbindungsabbruch). */
  retries?: number;
  retryDelayMs?: number;
}

export class MailService {
  private transporter: Transporter | null = null;
  private readonly retries: number;
  private readonly retryDelayMs: number;

  constructor(
    private readonly opts: MailServiceOptions,
    private readonly logger: Logger,
  ) {
    this.retries = opts.retries ?? 2;
    this.retryDelayMs = opts.retryDelayMs ?? 500;
  }

  private getTransporter(): Transporter {
    this.transporter ??= nodemailer.createTransport({
      host: this.opts.host,
      port: this.opts.port,
      secure: this.opts.secure,
      auth: { user: this.opts.user, pass: this.opts.pass },
    });
    return this.transporter;
  }

  /** Prüft die SMTP-Verbindung (Login inklusive), ohne eine Mail zu senden. */
  async verify(): Promise<void> {
    if (!this.opts.enabled) {
      throw new AppError(
        'Mailversand ist nicht aktiviert (MAIL_ENABLED=false)',
        503,
        'MAIL_DISABLED',
      );
    }
    try {
      await this.getTransporter().verify();
    } catch (err) {
      throw new AppError(this.safeErrorMessage(err), 502, 'SMTP_VERIFY_FAILED');
    }
  }

  /**
   * Sendet eine Mail. Wirft nie — Fehler kommen als `{ok: false, error}`
   * zurück, damit ein Massenversand (viele Mitglieder) an einer einzelnen
   * fehlgeschlagenen Adresse nicht abbricht.
   */
  async send(message: MailMessage): Promise<MailSendResult> {
    if (!this.opts.enabled) {
      return { ok: false, error: 'Mailversand ist nicht aktiviert (MAIL_ENABLED=false)' };
    }

    let lastError = '';
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        const info = await this.getTransporter().sendMail({
          from: this.opts.from,
          to: message.to,
          cc: message.cc,
          subject: message.subject,
          text: message.text,
          attachments: message.attachments,
        });
        return { ok: true, messageId: info.messageId };
      } catch (err) {
        lastError = this.safeErrorMessage(err);
        this.logger.warn(
          { to: message.to, attempt, of: this.retries, error: lastError },
          'Mailversand fehlgeschlagen',
        );
        if (attempt < this.retries) {
          await new Promise((resolve) => setTimeout(resolve, this.retryDelayMs));
        }
      }
    }
    return { ok: false, error: lastError };
  }

  /** Entfernt das SMTP-Passwort aus Fehlermeldungen, bevor sie geloggt/zurückgegeben werden. */
  private safeErrorMessage(err: unknown): string {
    const message = err instanceof Error ? err.message : 'Unbekannter Fehler beim Mailversand';
    return this.opts.pass ? message.split(this.opts.pass).join('***') : message;
  }
}
