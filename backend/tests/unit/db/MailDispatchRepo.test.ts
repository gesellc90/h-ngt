import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Db } from '../../../src/db/client.js';
import { MembersRepo } from '../../../src/db/repos/MembersRepo.js';
import { MailDispatchRepo } from '../../../src/db/repos/MailDispatchRepo.js';
import { createTestDb } from './helpers.js';

describe('MailDispatchRepo', () => {
  let db: Db;
  let repo: MailDispatchRepo;
  let memberId: number;

  beforeEach(() => {
    db = createTestDb();
    repo = new MailDispatchRepo(db);
    const membersRepo = new MembersRepo(db);
    memberId = membersRepo.create({ username: 'alice', display_name: 'Alice' }).id;
  });

  afterEach(() => {
    db.close();
  });

  it('legt eine Versand-Zeile an und gibt sie zurück', () => {
    const row = repo.create({
      period: '2026-05',
      kind: 'member',
      member_id: memberId,
      recipient: 'alice@example.org',
      status: 'sent',
      total_cents: 490,
      error: null,
      message_id: '<abc@df.eu>',
      triggered_by: 'manual',
    });

    expect(row.id).toBeGreaterThan(0);
    expect(row.period).toBe('2026-05');
    expect(row.status).toBe('sent');
    expect(row.total_cents).toBe(490);
  });

  it('findByPeriod liefert nur Zeilen des angegebenen Monats, älteste zuerst', () => {
    repo.create({
      period: '2026-04',
      kind: 'summary',
      member_id: null,
      recipient: 'wk@nassovia.de',
      status: 'sent',
      total_cents: null,
      error: null,
      message_id: null,
      triggered_by: 'schedule',
    });
    repo.create({
      period: '2026-05',
      kind: 'member',
      member_id: memberId,
      recipient: 'alice@example.org',
      status: 'sent',
      total_cents: 100,
      error: null,
      message_id: null,
      triggered_by: 'schedule',
    });
    repo.create({
      period: '2026-05',
      kind: 'summary',
      member_id: null,
      recipient: 'wk@nassovia.de',
      status: 'failed',
      total_cents: null,
      error: 'SMTP-Fehler',
      message_id: null,
      triggered_by: 'schedule',
    });

    const may = repo.findByPeriod('2026-05');
    expect(may).toHaveLength(2);
    expect(may.every((r) => r.period === '2026-05')).toBe(true);
  });

  describe('hasSent', () => {
    it('ist false, solange nichts erfolgreich versendet wurde', () => {
      expect(repo.hasSent('2026-05', 'member', memberId)).toBe(false);
      expect(repo.hasSent('2026-05', 'summary', null)).toBe(false);
    });

    it('wird nach einem erfolgreichen Mitglieder-Versand true', () => {
      repo.create({
        period: '2026-05',
        kind: 'member',
        member_id: memberId,
        recipient: 'alice@example.org',
        status: 'sent',
        total_cents: 100,
        error: null,
        message_id: null,
        triggered_by: 'manual',
      });
      expect(repo.hasSent('2026-05', 'member', memberId)).toBe(true);
      // Ein anderer Monat bleibt unberührt.
      expect(repo.hasSent('2026-06', 'member', memberId)).toBe(false);
    });

    it('bleibt nach einem fehlgeschlagenen Versand false (Retry möglich)', () => {
      repo.create({
        period: '2026-05',
        kind: 'member',
        member_id: memberId,
        recipient: 'alice@example.org',
        status: 'failed',
        total_cents: 100,
        error: 'SMTP-Fehler',
        message_id: null,
        triggered_by: 'manual',
      });
      expect(repo.hasSent('2026-05', 'member', memberId)).toBe(false);
    });

    it('wird nach einer erfolgreichen Sammelmail true', () => {
      repo.create({
        period: '2026-05',
        kind: 'summary',
        member_id: null,
        recipient: 'xxxx@nassovia.de',
        status: 'sent',
        total_cents: 1000,
        error: null,
        message_id: null,
        triggered_by: 'schedule',
      });
      expect(repo.hasSent('2026-05', 'summary', null)).toBe(true);
    });
  });

  it('verhindert per DB-Constraint eine zweite erfolgreiche Mitglieder-Mail im selben Monat', () => {
    repo.create({
      period: '2026-05',
      kind: 'member',
      member_id: memberId,
      recipient: 'alice@example.org',
      status: 'sent',
      total_cents: 100,
      error: null,
      message_id: null,
      triggered_by: 'manual',
    });

    expect(() =>
      repo.create({
        period: '2026-05',
        kind: 'member',
        member_id: memberId,
        recipient: 'alice@example.org',
        status: 'sent',
        total_cents: 100,
        error: null,
        message_id: null,
        triggered_by: 'manual',
      }),
    ).toThrow();
  });
});
