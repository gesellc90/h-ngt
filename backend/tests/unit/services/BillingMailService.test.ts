/**
 * Unit-Tests für BillingMailService — die Kernlogik des automatischen
 * Monatsabrechnungs-Versands (M15).
 *
 * Läuft gegen eine echte In-Memory-DB (ReportService, MembersRepo,
 * MailDispatchRepo, AuditLogRepo) — nur MailService ist gefaked, damit keine
 * echte SMTP-Verbindung nötig ist und der Versand exakt geprüft werden kann.
 *
 * Getestete Szenarien:
 *  - Mitglied mit E-Mail + Verbrauch → gesendet, Anhang + Protokoll-Zeile
 *  - Mitglied ohne E-Mail / ohne Verbrauch → übersprungen, kein Versand
 *  - Erneuter Lauf: bereits versendet → übersprungen, kein zweiter Versand
 *  - dryRun: nichts wird versendet oder gespeichert, Status "planned"
 *  - Fehlgeschlagener Versand → "failed", ein erneuter Lauf versucht erneut
 *  - Sammelmail: 4 Anhänge, CC, idempotent über hasSent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import { createTestDb } from '../db/helpers.js';
import { MembersRepo } from '../../../src/db/repos/MembersRepo.js';
import { DrinksRepo } from '../../../src/db/repos/DrinksRepo.js';
import { BookingsRepo } from '../../../src/db/repos/BookingsRepo.js';
import { ZeigerRepo } from '../../../src/db/repos/ZeigerRepo.js';
import { VerbindungenRepo } from '../../../src/db/repos/VerbindungenRepo.js';
import { AuditLogRepo } from '../../../src/db/repos/AuditLogRepo.js';
import { MailDispatchRepo } from '../../../src/db/repos/MailDispatchRepo.js';
import { ReportService } from '../../../src/services/ReportService.js';
import { BillingMailService } from '../../../src/services/BillingMailService.js';
import type { MailService, MailSendResult } from '../../../src/services/MailService.js';
import type { Db } from '../../../src/db/client.js';

async function setup() {
  const db: Db = createTestDb();
  const membersRepo = new MembersRepo(db);
  const drinksRepo = new DrinksRepo(db);
  const bookingsRepo = new BookingsRepo(db);
  const zeigerRepo = new ZeigerRepo(db);
  const verbindungenRepo = new VerbindungenRepo(db);
  const auditLogRepo = new AuditLogRepo(db);
  const mailDispatchRepo = new MailDispatchRepo(db);
  const reportService = new ReportService(bookingsRepo, membersRepo, zeigerRepo, verbindungenRepo);

  const hash = await bcrypt.hash('pw', 10);
  const alice = membersRepo.create({
    username: 'alice',
    display_name: 'Alice',
    password_hash: hash,
    email: 'alice@example.org',
  });
  const bob = membersRepo.create({
    username: 'bob',
    display_name: 'Bob',
    password_hash: hash,
    // keine E-Mail hinterlegt
  });
  const cola = drinksRepo.create({ name: 'Cola', categoryId: 1, initialPriceCents: 120 });

  const send = vi.fn<(msg: unknown) => Promise<MailSendResult>>().mockResolvedValue({
    ok: true,
    messageId: '<test@df.eu>',
  });
  const mailService = { send } as unknown as MailService;

  const billingMailService = new BillingMailService(
    reportService,
    membersRepo,
    mailService,
    mailDispatchRepo,
    auditLogRepo,
    'xxxx@nassovia.de',
    ['wk@nassovia.de'],
  );

  function bookFor(memberId: number, iso: string): void {
    db.prepare(
      `INSERT INTO bookings (member_id, drink_id, price_cents_snapshot, booked_at)
       VALUES (?, ?, ?, ?)`,
    ).run(memberId, cola.id, 120, iso);
  }

  return {
    db,
    membersRepo,
    mailDispatchRepo,
    billingMailService,
    send,
    alice,
    bob,
    bookFor,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('BillingMailService.run — Mitglieder-Mails', () => {
  it('sendet an ein Mitglied mit E-Mail und Verbrauch, inkl. PDF-Anhang', async () => {
    const { billingMailService, send, alice, bookFor } = await setup();
    bookFor(alice.id, '2026-05-10T12:00:00.000Z');

    const result = await billingMailService.run(2026, 5, { triggeredBy: 'manual', dryRun: false });
    const aliceLine = result.lines.find((l) => l.kind === 'member' && l.memberId === alice.id);

    expect(aliceLine?.status).toBe('sent');
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'alice@example.org',
        attachments: expect.arrayContaining([
          expect.objectContaining({ contentType: 'application/pdf' }),
        ]),
      }),
    );
  });

  it('überspringt ein Mitglied ohne hinterlegte E-Mail-Adresse', async () => {
    const { billingMailService, send, bob, bookFor } = await setup();
    bookFor(bob.id, '2026-05-10T12:00:00.000Z');

    const result = await billingMailService.run(2026, 5, { triggeredBy: 'manual', dryRun: false });
    const bobLine = result.lines.find((l) => l.kind === 'member' && l.memberId === bob.id);

    expect(bobLine).toMatchObject({ status: 'skipped', reason: 'Keine E-Mail-Adresse hinterlegt' });
    // Nur die Sammelmail geht raus – für Bob (keine E-Mail) wird nichts versendet.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: 'xxxx@nassovia.de' }));
  });

  it('überspringt ein Mitglied ohne Verbrauch im Monat', async () => {
    const { billingMailService, alice } = await setup();
    // Keine Buchung für Alice im Mai.
    const result = await billingMailService.run(2026, 5, { triggeredBy: 'manual', dryRun: false });
    const aliceLine = result.lines.find((l) => l.kind === 'member' && l.memberId === alice.id);
    expect(aliceLine).toMatchObject({
      status: 'skipped',
      reason: 'Kein Verbrauch in diesem Monat',
    });
  });

  it('versendet bei einem erneuten Lauf nicht doppelt (Idempotenz)', async () => {
    const { billingMailService, send, alice, bookFor } = await setup();
    bookFor(alice.id, '2026-05-10T12:00:00.000Z');

    await billingMailService.run(2026, 5, { triggeredBy: 'manual', dryRun: false });
    send.mockClear();
    const second = await billingMailService.run(2026, 5, { triggeredBy: 'manual', dryRun: false });

    const aliceLine = second.lines.find((l) => l.kind === 'member' && l.memberId === alice.id);
    expect(aliceLine).toMatchObject({ status: 'skipped', reason: 'Bereits versendet' });
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ to: 'alice@example.org' }));
  });

  it('dryRun berechnet den Plan, versendet aber nichts und schreibt kein Protokoll', async () => {
    const { billingMailService, mailDispatchRepo, send, alice, bookFor } = await setup();
    bookFor(alice.id, '2026-05-10T12:00:00.000Z');

    const result = await billingMailService.run(2026, 5, { triggeredBy: 'manual', dryRun: true });
    const aliceLine = result.lines.find((l) => l.kind === 'member' && l.memberId === alice.id);

    expect(aliceLine?.status).toBe('planned');
    expect(send).not.toHaveBeenCalled();
    expect(mailDispatchRepo.findByPeriod('2026-05')).toHaveLength(0);
  });

  it('markiert einen fehlgeschlagenen Versand als "failed" und versucht beim nächsten Lauf erneut', async () => {
    const { billingMailService, send, alice, bookFor } = await setup();
    bookFor(alice.id, '2026-05-10T12:00:00.000Z');
    send.mockResolvedValueOnce({ ok: false, error: 'SMTP-Fehler' });

    const first = await billingMailService.run(2026, 5, { triggeredBy: 'manual', dryRun: false });
    const firstLine = first.lines.find((l) => l.kind === 'member' && l.memberId === alice.id);
    expect(firstLine).toMatchObject({ status: 'failed', reason: 'SMTP-Fehler' });

    send.mockResolvedValueOnce({ ok: true, messageId: '<retry@df.eu>' });
    const second = await billingMailService.run(2026, 5, { triggeredBy: 'manual', dryRun: false });
    const secondLine = second.lines.find((l) => l.kind === 'member' && l.memberId === alice.id);
    expect(secondLine?.status).toBe('sent');
  });

  it('protokolliert den auslösenden Admin bei manuellem Versand im Audit-Log', async () => {
    const { billingMailService, db, membersRepo, alice, bookFor } = await setup();
    bookFor(alice.id, '2026-05-10T12:00:00.000Z');
    const admin = membersRepo.create({
      username: 'admin',
      display_name: 'Admin',
      password_hash: 'x',
      role: 'admin',
    });

    await billingMailService.run(2026, 5, {
      triggeredBy: 'manual',
      dryRun: false,
      actorId: admin.id,
    });

    const entry = db
      .prepare("SELECT actor_id FROM audit_log WHERE event_type = 'mail_member_sent'")
      .get() as { actor_id: number } | undefined;
    expect(entry?.actor_id).toBe(admin.id);
  });
});

describe('BillingMailService.run — Sammelmail', () => {
  it('sendet die Sammelmail mit vier Anhängen (PDF+CSV je Sammel-Abrechnung und Zeiger-Übersicht) an die WK, mit CC', async () => {
    const { billingMailService, send, alice, bookFor } = await setup();
    bookFor(alice.id, '2026-05-10T12:00:00.000Z');

    const result = await billingMailService.run(2026, 5, { triggeredBy: 'manual', dryRun: false });
    const summaryLine = result.lines.find((l) => l.kind === 'summary');

    expect(summaryLine?.status).toBe('sent');
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'xxxx@nassovia.de',
        cc: ['wk@nassovia.de'],
        attachments: expect.arrayContaining([
          expect.objectContaining({ filename: expect.stringContaining('sammel_abrechnung') }),
          expect.objectContaining({ filename: expect.stringContaining('zeiger_uebersicht') }),
        ]),
      }),
    );
    const attachmentsArg = send.mock.calls.find(
      (call) => (call[0] as { to: string }).to === 'xxxx@nassovia.de',
    )?.[0] as { attachments: unknown[] };
    expect(attachmentsArg.attachments).toHaveLength(4);
  });

  it('versendet die Sammelmail bei einem erneuten Lauf nicht doppelt', async () => {
    const { billingMailService, send, alice, bookFor } = await setup();
    bookFor(alice.id, '2026-05-10T12:00:00.000Z');

    await billingMailService.run(2026, 5, { triggeredBy: 'manual', dryRun: false });
    send.mockClear();
    const second = await billingMailService.run(2026, 5, { triggeredBy: 'manual', dryRun: false });

    const summaryLine = second.lines.find((l) => l.kind === 'summary');
    expect(summaryLine).toMatchObject({ status: 'skipped', reason: 'Bereits versendet' });
    expect(send).not.toHaveBeenCalledWith(expect.objectContaining({ to: 'xxxx@nassovia.de' }));
  });
});
