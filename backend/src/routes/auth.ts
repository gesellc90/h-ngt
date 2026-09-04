import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { loginSchema, verifyEmailSchema } from '../schemas/auth.js';
import { updateSelfSchema } from '../schemas/profile.js';
import { AuthError } from '../services/AuthService.js';
import { AppError } from '../middleware/errorHandler.js';
import { authenticate, type AuthenticatedRequest } from '../middleware/authenticate.js';
import { toPublicMember } from '../services/MembersService.js';
import { avatarUpload, saveAvatar, removeAvatarFile } from '../utils/avatar.js';
import type { AuthService } from '../services/AuthService.js';
import type { MembersService } from '../services/MembersService.js';
import type { EmailVerificationService } from '../services/EmailVerificationService.js';
import type { Env } from '../utils/env.js';

/**
 * Erstellt den Auth-Router.
 * Rate-Limit: 5 Versuche pro IP und 15 Minuten auf POST /login.
 */
export function createAuthRouter(
  authService: AuthService,
  membersService: MembersService,
  emailVerificationService: EmailVerificationService,
  avatarDir: string,
  env: Env,
): Router {
  const router = Router();

  const auth = authenticate(authService);

  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 Minuten
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Zu viele Login-Versuche. Bitte in 15 Minuten erneut versuchen.' },
    skipSuccessfulRequests: false,
    // In E2E-Tests deaktivieren (alle Requests kämen von 127.0.0.1,
    // der gemeinsame Bucket würde nach 5 Logins die restlichen Tests blockieren).
    // Bewusst als expliziter Opt-out: Der E2E-Harness läuft produktionsnah mit
    // NODE_ENV=production und ist auf diese Hatch angewiesen. Als Guardrail warnt
    // app.ts beim Start laut, falls das Flag in Produktion gesetzt ist.
    skip: () => process.env['DISABLE_RATE_LIMIT'] === 'true',
  });

  // M16 — E-Mail-Verifizierung: gegen Token-Erraten (POST /verify-email, IP-basiert)
  // bzw. Mail-Spam per Klick auf "erneut senden" (Resend, eingeloggt).
  const verifyEmailLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.' },
    skip: () => process.env['DISABLE_RATE_LIMIT'] === 'true',
  });
  const resendVerificationLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen.' },
    skip: () => process.env['DISABLE_RATE_LIMIT'] === 'true',
  });

  // ---------------------------------------------------------------------------
  // POST /auth/login
  // ---------------------------------------------------------------------------
  router.post('/login', loginLimiter, async (req, res, next) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Eingabe', details: parsed.error.flatten() });
      return;
    }

    const ip = req.ip ?? 'unknown';
    const userAgent = req.headers['user-agent'] ?? 'unknown';

    try {
      const result = await authService.login(parsed.data.username, parsed.data.password, {
        ip,
        userAgent,
      });
      res.status(200).json(result);
    } catch (err) {
      if (err instanceof AuthError) {
        res.status(401).json({ error: err.message, code: err.code });
        return;
      }
      next(err);
    }
  });

  // ---------------------------------------------------------------------------
  // POST /auth/verify-email — unauthentifiziert (der Link wird ggf. in einem
  // anderen Browser/Gerät geöffnet als dem, in dem das Mitglied eingeloggt ist)
  // ---------------------------------------------------------------------------
  router.post('/verify-email', verifyEmailLimiter, (req, res, next) => {
    const parsed = verifyEmailSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Eingabe', details: parsed.error.flatten() });
      return;
    }

    try {
      const member = emailVerificationService.verify(parsed.data.token);
      res.json(toPublicMember(member));
    } catch (err) {
      next(err);
    }
  });

  // ---------------------------------------------------------------------------
  // POST /auth/me/verify-email/resend  (geschützt) — "Bestätigungsmail erneut senden"
  // ---------------------------------------------------------------------------
  router.post(
    '/me/verify-email/resend',
    auth,
    resendVerificationLimiter,
    async (req, res, next) => {
      if (!env.MAIL_ENABLED) {
        next(
          new AppError(
            'Mailversand ist nicht aktiviert (MAIL_ENABLED=false)',
            503,
            'MAIL_DISABLED',
          ),
        );
        return;
      }

      try {
        const { auth: payload } = req as AuthenticatedRequest;
        const memberId = Number(payload.sub);
        await emailVerificationService.resend(memberId, memberId);
        res.status(204).send();
      } catch (err) {
        next(err);
      }
    },
  );

  // ---------------------------------------------------------------------------
  // GET /auth/me  (geschützt)
  // ---------------------------------------------------------------------------
  router.get('/me', auth, (req, res, next) => {
    try {
      const { auth: payload } = req as AuthenticatedRequest;
      const member = membersService.findById(Number(payload.sub));
      res.json(toPublicMember(member));
    } catch (err) {
      next(err);
    }
  });

  // ---------------------------------------------------------------------------
  // PATCH /auth/me — Eigenes Profil ändern (display_name, email, password)
  // ---------------------------------------------------------------------------
  router.patch('/me', auth, async (req, res, next) => {
    const parsed = updateSelfSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Ungültige Eingabe', details: parsed.error.flatten() });
      return;
    }

    try {
      const { auth: payload } = req as AuthenticatedRequest;
      const actorId = Number(payload.sub);

      const { current_password, ...changes } = parsed.data;

      // Passwortänderung nur mit korrektem aktuellen Passwort zulassen.
      if (changes.password !== undefined) {
        const ok = await authService.verifyCurrentPassword(actorId, current_password ?? '');
        if (!ok) {
          res.status(403).json({
            error: 'Aktuelles Passwort ist falsch',
            code: 'INVALID_CURRENT_PASSWORD',
          });
          return;
        }
      }

      const member = await membersService.update(actorId, changes, actorId);
      res.json(toPublicMember(member));
    } catch (err) {
      next(err);
    }
  });

  // ---------------------------------------------------------------------------
  // POST /auth/me/avatar — Profilbild hochladen (max 5 MB, Bild → 256×256 WebP)
  // ---------------------------------------------------------------------------
  router.post('/me/avatar', auth, avatarUpload.single('avatar'), async (req, res, next) => {
    if (!req.file) {
      res.status(400).json({ error: 'Keine Datei übermittelt' });
      return;
    }

    try {
      const { auth: payload } = req as AuthenticatedRequest;
      const memberId = Number(payload.sub);

      const filename = await saveAvatar(avatarDir, memberId, req.file.buffer);
      const member = await membersService.update(memberId, { avatar_path: filename }, memberId);
      res.json(toPublicMember(member));
    } catch (err) {
      next(err);
    }
  });

  // ---------------------------------------------------------------------------
  // DELETE /auth/me/avatar — Profilbild entfernen
  // ---------------------------------------------------------------------------
  router.delete('/me/avatar', auth, async (req, res, next) => {
    try {
      const { auth: payload } = req as AuthenticatedRequest;
      const memberId = Number(payload.sub);
      const existing = membersService.findById(memberId);

      removeAvatarFile(avatarDir, existing.avatar_path);

      const member = await membersService.update(memberId, { avatar_path: null }, memberId);
      res.json(toPublicMember(member));
    } catch (err) {
      next(err);
    }
  });

  // ---------------------------------------------------------------------------
  // POST /auth/logout  (geschützt)
  // ---------------------------------------------------------------------------
  router.post('/logout', auth, (req, res) => {
    const { auth: payload } = req as AuthenticatedRequest;
    authService.logout(payload.jti, payload.exp);
    res.status(204).send();
  });

  return router;
}
