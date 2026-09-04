import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticate, type AuthenticatedRequest } from '../middleware/authenticate.js';
import { requireRole } from '../middleware/requireRole.js';
import { AppError } from '../middleware/errorHandler.js';
import {
  mailPeriodQuerySchema,
  mailDispatchBodySchema,
  mailTestBodySchema,
} from '../schemas/mail.js';
import type { AuthService } from '../services/AuthService.js';
import type { MailService } from '../services/MailService.js';
import type { BillingMailService } from '../services/BillingMailService.js';
import type { MailDispatchRepo } from '../db/repos/MailDispatchRepo.js';
import type { Env } from '../utils/env.js';

// ---------------------------------------------------------------------------
// Mail-Router (M15) — automatischer Versand der Monatsabrechnungen.
// Alle Endpunkte Admin-only.
// ---------------------------------------------------------------------------

function period(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export function createMailRouter(
  authService: AuthService,
  mailService: MailService,
  billingMailService: BillingMailService,
  mailDispatchRepo: MailDispatchRepo,
  env: Env,
): Router {
  const router = Router();
  const auth = authenticate(authService);
  const admin = requireRole('admin');

  // Testmail/Versand dürfen nicht beliebig oft pro Minute ausgelöst werden —
  // sowohl gegen versehentliches Mehrfachklicken als auch gegen ein
  // df.eu-Rate-Limit auf dem SMTP-Konto.
  const mailLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Zu viele Mail-Aktionen. Bitte in ein paar Minuten erneut versuchen.' },
    skip: () => process.env['DISABLE_RATE_LIMIT'] === 'true',
  });

  // -------------------------------------------------------------------------
  // GET /mail/status  (Admin) — Konfiguration ohne Zugangsdaten
  // -------------------------------------------------------------------------
  router.get('/status', auth, admin, (_req, res) => {
    res.json({
      enabled: env.MAIL_ENABLED,
      scheduleEnabled: env.MAIL_SCHEDULE_ENABLED,
      scheduleHour: env.MAIL_SCHEDULE_HOUR,
      smtpHost: env.SMTP_HOST,
      smtpPort: env.SMTP_PORT,
      smtpSecure: env.SMTP_SECURE,
      summaryTo: env.MAIL_SUMMARY_TO || null,
      summaryCc: env.MAIL_SUMMARY_CC
        ? env.MAIL_SUMMARY_CC.split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
    });
  });

  // -------------------------------------------------------------------------
  // POST /mail/test  (Admin) — Testmail an eine frei wählbare Adresse
  // -------------------------------------------------------------------------
  router.post('/test', auth, admin, mailLimiter, async (req, res, next) => {
    const parsed = mailTestBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Eingabe', details: parsed.error.flatten() });
      return;
    }
    try {
      await mailService.verify();
      const result = await mailService.send({
        to: parsed.data.to,
        subject: 'Testmail — Hängt! Getränkeabrechnung',
        text: [
          'Diese Testmail bestätigt, dass der SMTP-Versand korrekt konfiguriert ist.',
          '',
          `Server: ${env.SMTP_HOST}:${env.SMTP_PORT}`,
          '',
          'Bierwart',
          'Nassovia',
        ].join('\n'),
      });
      if (!result.ok) {
        res.status(502).json({ error: result.error ?? 'Testmail konnte nicht gesendet werden' });
        return;
      }
      res.json({ ok: true, messageId: result.messageId });
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------------------------
  // GET /mail/preview?year=&month=  (Admin) — Dry-Run: wer bekäme was
  // -------------------------------------------------------------------------
  router.get('/preview', auth, admin, async (req, res, next) => {
    const parsed = mailPeriodQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Parameter', details: parsed.error.flatten() });
      return;
    }
    try {
      const { year, month } = parsed.data;
      const result = await billingMailService.run(year, month, {
        triggeredBy: 'manual',
        dryRun: true,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------------------------
  // POST /mail/dispatch  (Admin) — "Jetzt versenden" (idempotent, siehe
  // BillingMailService: bereits versendete Empfänger werden übersprungen)
  // -------------------------------------------------------------------------
  router.post('/dispatch', auth, admin, mailLimiter, async (req, res, next) => {
    const parsed = mailDispatchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Eingabe', details: parsed.error.flatten() });
      return;
    }
    if (!env.MAIL_ENABLED) {
      next(
        new AppError('Mailversand ist nicht aktiviert (MAIL_ENABLED=false)', 503, 'MAIL_DISABLED'),
      );
      return;
    }
    try {
      const { year, month } = parsed.data;
      const actorId = Number((req as AuthenticatedRequest).auth.sub);
      const result = await billingMailService.run(year, month, {
        triggeredBy: 'manual',
        dryRun: false,
        actorId,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  // -------------------------------------------------------------------------
  // GET /mail/dispatches?year=&month=  (Admin) — Versandprotokoll
  // -------------------------------------------------------------------------
  router.get('/dispatches', auth, admin, (req, res, next) => {
    const parsed = mailPeriodQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Parameter', details: parsed.error.flatten() });
      return;
    }
    try {
      const { year, month } = parsed.data;
      res.json(mailDispatchRepo.findByPeriod(period(year, month)));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
