import crypto from 'node:crypto';
import type { Logger } from 'pino';
import type { EmailVerificationRepo } from '../db/repos/EmailVerificationRepo.js';
import type { MembersRepo } from '../db/repos/MembersRepo.js';
import type { AuditLogRepo } from '../db/repos/AuditLogRepo.js';
import type { MailService } from './MailService.js';
import type { MemberRow } from '../db/types.js';
import { AppError } from '../middleware/errorHandler.js';

// ---------------------------------------------------------------------------
// EmailVerificationService (M16) — Bestätigungslinks für Mitglieder-E-Mails.
//
// Der Link zeigt bewusst auf das Frontend (`<APP_BASE_URL>/verify-email?token=…`),
// nicht direkt auf die API — die SPA-Seite ruft POST /auth/verify-email auf und
// zeigt ein gestaltetes Ergebnis statt rohem JSON. Der Versand selbst läuft
// über den vorhandenen MailService (M15) — kein zweiter Transport.
//
// Kein Gating: eine (noch) nicht verifizierte Adresse verhindert nichts,
// weder Login noch den Monatsabrechnungs-Versand aus M15. Der Status ist
// aktuell rein informativ (Badge im Profil/Admin-UI).
// ---------------------------------------------------------------------------

const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function verificationMailText(member: MemberRow, link: string): string {
  return [
    `Hallo ${member.display_name},`,
    '',
    'bitte bestätige deine E-Mail-Adresse für die Hängt!-App, indem du auf',
    'folgenden Link klickst:',
    '',
    link,
    '',
    'Der Link ist 24 Stunden gültig. Wenn du diese Adresse nicht selbst',
    'hinterlegt hast, kannst du diese Mail ignorieren.',
    '',
    'Bierwart',
    'Nassovia',
  ].join('\n');
}

export class EmailVerificationService {
  constructor(
    private readonly repo: EmailVerificationRepo,
    private readonly membersRepo: MembersRepo,
    private readonly mailService: MailService,
    private readonly auditLog: AuditLogRepo,
    private readonly appBaseUrl: string,
    private readonly logger: Logger,
  ) {}

  /**
   * Stellt einen neuen Bestätigungs-Token für die aktuell hinterlegte
   * E-Mail-Adresse des Mitglieds aus und verschickt ihn. Entwertet zuvor
   * alle noch offenen Tokens desselben Mitglieds (siehe
   * `EmailVerificationRepo.invalidateOpenForMember`).
   *
   * Wirft nie wegen eines fehlgeschlagenen Mailversands — `MailService.send`
   * gibt Fehler als `{ok: false}` zurück statt zu werfen, damit ein
   * `PATCH /auth/me`/`PATCH /members/:id` nie an einem SMTP-Problem scheitert.
   * Ist kein Mailversand nötig (keine Adresse hinterlegt), passiert nichts.
   */
  async issueAndSend(member: MemberRow, actorId: number | null): Promise<void> {
    if (!member.email) return;

    const tokenPlain = crypto.randomBytes(32).toString('base64url');
    const tokenHash = hashToken(tokenPlain);
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

    this.repo.invalidateOpenForMember(member.id);
    this.repo.create({
      member_id: member.id,
      email: member.email,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });
    this.auditLog.create({
      event_type: 'email_verification_sent',
      actor_id: actorId,
      target_type: 'member',
      target_id: member.id,
      meta: { email: member.email },
    });

    const link = `${this.appBaseUrl}/verify-email?token=${tokenPlain}`;
    const result = await this.mailService.send({
      to: member.email,
      subject: 'Bitte bestätige deine E-Mail-Adresse — Hängt!',
      text: verificationMailText(member, link),
    });
    if (!result.ok) {
      this.logger.warn(
        { memberId: member.id, error: result.error },
        'Verifizierungsmail konnte nicht gesendet werden',
      );
    }
  }

  /**
   * "Bestätigungsmail erneut senden"-Button im Profil. Der `MAIL_DISABLED`-Fall
   * (503) wird bewusst in der Route geprüft (siehe auth.ts), analog zu
   * POST /mail/test aus M15 — hier nur die fachlichen Vorbedingungen.
   */
  async resend(memberId: number, actorId: number): Promise<void> {
    const member = this.membersRepo.findById(memberId);
    if (!member) {
      throw new AppError('Mitglied nicht gefunden', 404, 'NOT_FOUND');
    }
    if (!member.email) {
      throw new AppError('Keine E-Mail-Adresse hinterlegt', 400, 'NO_EMAIL');
    }
    if (member.email_verified_at) {
      throw new AppError('E-Mail-Adresse ist bereits bestätigt', 409, 'ALREADY_VERIFIED');
    }
    await this.issueAndSend(member, actorId);
  }

  /**
   * Löst einen Token ein. Wirft mit klar unterscheidbaren Fehlercodes, damit
   * die Frontend-Seite `/verify-email` einen passenden Zustand anzeigen kann.
   */
  verify(tokenPlain: string): MemberRow {
    const tokenHash = hashToken(tokenPlain);
    const row = this.repo.findByTokenHash(tokenHash);
    if (!row) {
      throw new AppError('Ungültiger Bestätigungslink', 400, 'TOKEN_INVALID');
    }
    if (row.used_at) {
      throw new AppError('Bestätigungslink wurde bereits verwendet', 409, 'TOKEN_USED');
    }
    if (new Date(row.expires_at).getTime() < Date.now()) {
      throw new AppError('Bestätigungslink ist abgelaufen', 410, 'TOKEN_EXPIRED');
    }

    const member = this.membersRepo.findById(row.member_id);
    if (!member || member.email !== row.email) {
      throw new AppError(
        'Die E-Mail-Adresse wurde seitdem geändert — bitte neuen Bestätigungslink anfordern',
        409,
        'EMAIL_CHANGED',
      );
    }

    this.repo.markUsed(row.id);
    const verifiedAt = new Date().toISOString();
    this.membersRepo.markEmailVerified(member.id, verifiedAt);
    this.auditLog.create({
      event_type: 'email_verified',
      actor_id: member.id,
      target_type: 'member',
      target_id: member.id,
      meta: { email: member.email },
    });

    return this.membersRepo.findById(member.id)!;
  }
}
