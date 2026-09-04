/**
 * Unit-Tests für EmailVerificationService (M16).
 *
 * Läuft gegen eine echte In-Memory-DB (MembersRepo, EmailVerificationRepo,
 * AuditLogRepo) — nur MailService ist gefaked, damit keine echte
 * SMTP-Verbindung nötig ist und garantiert keine Mail rausgeht.
 *
 * Getestete Szenarien:
 *  - Token wird nur als Hash gespeichert, nie im Klartext
 *  - Erfolgreiche Verifizierung markiert Token + Mitglied
 *  - Abgelaufener Token → TOKEN_EXPIRED
 *  - Bereits benutzter Token → TOKEN_USED
 *  - Unbekannter Token → TOKEN_INVALID
 *  - Geänderte Adresse seit Ausstellung → EMAIL_CHANGED
 *  - Neuer Token entwertet offene alte Tokens desselben Mitglieds
 *  - resend(): NO_EMAIL, ALREADY_VERIFIED, sonst neuer Versand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import pino from 'pino';
import { createTestDb } from '../db/helpers.js';
import { MembersRepo } from '../../../src/db/repos/MembersRepo.js';
import { EmailVerificationRepo } from '../../../src/db/repos/EmailVerificationRepo.js';
import { AuditLogRepo } from '../../../src/db/repos/AuditLogRepo.js';
import { EmailVerificationService } from '../../../src/services/EmailVerificationService.js';
import { AppError } from '../../../src/middleware/errorHandler.js';
import type { MailService, MailSendResult } from '../../../src/services/MailService.js';
import type { Db } from '../../../src/db/client.js';

const silentLogger = pino({ level: 'silent' });

function extractToken(link: string): string {
  const url = new URL(link);
  return url.searchParams.get('token')!;
}

async function setup() {
  const db: Db = createTestDb();
  const membersRepo = new MembersRepo(db);
  const emailVerificationRepo = new EmailVerificationRepo(db);
  const auditLogRepo = new AuditLogRepo(db);

  const alice = membersRepo.create({
    username: 'alice',
    display_name: 'Alice',
    email: 'alice@example.org',
  });

  const send = vi.fn<(msg: unknown) => Promise<MailSendResult>>().mockResolvedValue({
    ok: true,
    messageId: '<test@df.eu>',
  });
  const mailService = { send } as unknown as MailService;

  const service = new EmailVerificationService(
    emailVerificationRepo,
    membersRepo,
    mailService,
    auditLogRepo,
    'http://localhost:3001',
    silentLogger,
  );

  return { db, membersRepo, emailVerificationRepo, auditLogRepo, service, send, alice };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('EmailVerificationService.issueAndSend', () => {
  it('speichert den Token nur als SHA-256-Hash, nie im Klartext', async () => {
    const { emailVerificationRepo, service, alice, db } = await setup();

    await service.issueAndSend(alice, null);

    const row = db.prepare('SELECT * FROM email_verifications').get() as {
      token_hash: string;
    };
    expect(row.token_hash).toHaveLength(64); // hex-SHA-256
    expect(row.token_hash).not.toContain('http'); // kein Link/Klartext-Fragment

    const stored = emailVerificationRepo.findByTokenHash(row.token_hash);
    expect(stored).toBeDefined();
  });

  it('verschickt eine Mail mit einem Link auf APP_BASE_URL/verify-email', async () => {
    const { service, alice, send } = await setup();

    await service.issueAndSend(alice, null);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice@example.org',
        text: expect.stringContaining('http://localhost:3001/verify-email?token='),
      }),
    );
  });

  it('tut nichts, wenn das Mitglied keine E-Mail-Adresse hat', async () => {
    const { service, membersRepo, send } = await setup();
    const bob = membersRepo.create({ username: 'bob', display_name: 'Bob' });

    await service.issueAndSend(bob, null);

    expect(send).not.toHaveBeenCalled();
  });

  it('entwertet offene alte Tokens desselben Mitglieds beim Ausstellen eines neuen', async () => {
    const { service, alice, send, emailVerificationRepo, db } = await setup();

    await service.issueAndSend(alice, null);
    const firstLink = (send.mock.calls[0]?.[0] as { text: string }).text.match(
      /http:\S+/,
    )?.[0] as string;
    const firstToken = extractToken(firstLink);
    const firstHash = crypto.createHash('sha256').update(firstToken).digest('hex');

    await service.issueAndSend(alice, null);

    expect(emailVerificationRepo.findByTokenHash(firstHash)?.used_at).not.toBeNull();
    const rows = db.prepare('SELECT COUNT(*) AS c FROM email_verifications').get() as {
      c: number;
    };
    expect(rows.c).toBe(2);
  });

  it('protokolliert den Versand im Audit-Log', async () => {
    const { service, alice, auditLogRepo } = await setup();
    await service.issueAndSend(alice, alice.id);

    const entries = auditLogRepo.findByEventType('email_verification_sent');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actor_id: alice.id, target_id: alice.id });
  });
});

describe('EmailVerificationService.verify', () => {
  async function issueAndExtractToken(
    service: EmailVerificationService,
    send: ReturnType<typeof vi.fn>,
    member: Parameters<EmailVerificationService['issueAndSend']>[0],
  ): Promise<string> {
    await service.issueAndSend(member, null);
    const call = send.mock.calls[send.mock.calls.length - 1]?.[0] as { text: string };
    const link = call.text.match(/http:\S+/)?.[0] as string;
    return extractToken(link);
  }

  it('verifiziert bei gültigem Token und markiert das Mitglied', async () => {
    const { service, alice, send } = await setup();
    const token = await issueAndExtractToken(service, send, alice);

    const verified = service.verify(token);

    expect(verified.email_verified_at).not.toBeNull();
  });

  it('markiert den Token als benutzt', async () => {
    const { service, alice, send, emailVerificationRepo } = await setup();
    const token = await issueAndExtractToken(service, send, alice);
    const hash = crypto.createHash('sha256').update(token).digest('hex');

    service.verify(token);

    expect(emailVerificationRepo.findByTokenHash(hash)?.used_at).not.toBeNull();
  });

  it('wirft TOKEN_INVALID für einen unbekannten Token', async () => {
    const { service } = await setup();
    expect(() => service.verify('unbekannter-token')).toThrow(AppError);
    try {
      service.verify('unbekannter-token');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe('TOKEN_INVALID');
      expect((err as AppError).statusCode).toBe(400);
    }
  });

  it('wirft TOKEN_USED bei einem bereits eingelösten Token', async () => {
    const { service, alice, send } = await setup();
    const token = await issueAndExtractToken(service, send, alice);
    service.verify(token);

    try {
      service.verify(token);
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe('TOKEN_USED');
      expect((err as AppError).statusCode).toBe(409);
    }
  });

  it('wirft TOKEN_EXPIRED bei abgelaufenem Token', async () => {
    const { service, alice, send, db } = await setup();
    const token = await issueAndExtractToken(service, send, alice);
    const hash = crypto.createHash('sha256').update(token).digest('hex');
    // Ablaufzeit künstlich in die Vergangenheit setzen.
    db.prepare('UPDATE email_verifications SET expires_at = ? WHERE token_hash = ?').run(
      new Date(Date.now() - 1000).toISOString(),
      hash,
    );

    try {
      service.verify(token);
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe('TOKEN_EXPIRED');
      expect((err as AppError).statusCode).toBe(410);
    }
  });

  it('wirft EMAIL_CHANGED, wenn sich die Adresse seit Ausstellung geändert hat', async () => {
    const { service, alice, send, membersRepo } = await setup();
    const token = await issueAndExtractToken(service, send, alice);

    // Adresse ändert sich, NACHDEM der Token verschickt wurde.
    membersRepo.update(alice.id, { email: 'andere@example.org' });

    try {
      service.verify(token);
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe('EMAIL_CHANGED');
      expect((err as AppError).statusCode).toBe(409);
    }
  });

  it('protokolliert die Verifizierung im Audit-Log', async () => {
    const { service, alice, send, auditLogRepo } = await setup();
    const token = await issueAndExtractToken(service, send, alice);

    service.verify(token);

    const entries = auditLogRepo.findByEventType('email_verified');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ target_id: alice.id });
  });
});

describe('EmailVerificationService.resend', () => {
  it('wirft NO_EMAIL, wenn keine Adresse hinterlegt ist', async () => {
    const { service, membersRepo } = await setup();
    const bob = membersRepo.create({ username: 'bob', display_name: 'Bob' });

    try {
      await service.resend(bob.id, bob.id);
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe('NO_EMAIL');
      expect((err as AppError).statusCode).toBe(400);
    }
  });

  it('wirft ALREADY_VERIFIED, wenn die Adresse bereits bestätigt ist', async () => {
    const { service, alice, membersRepo } = await setup();
    membersRepo.markEmailVerified(alice.id, new Date().toISOString());

    try {
      await service.resend(alice.id, alice.id);
      expect.unreachable();
    } catch (err) {
      expect((err as AppError).code).toBe('ALREADY_VERIFIED');
      expect((err as AppError).statusCode).toBe(409);
    }
  });

  it('verschickt einen neuen Bestätigungslink bei unverifizierter Adresse', async () => {
    const { service, alice, send } = await setup();

    await service.resend(alice.id, alice.id);

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'alice@example.org' }));
  });
});
