import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Db } from '../../../src/db/client.js';
import { MembersRepo } from '../../../src/db/repos/MembersRepo.js';
import { createTestDb } from './helpers.js';

describe('MembersRepo', () => {
  let db: Db;
  let repo: MembersRepo;

  beforeEach(() => {
    db = createTestDb();
    repo = new MembersRepo(db);
  });

  afterEach(() => {
    db.close();
  });

  // ---------------------------------------------------------------------------
  // create
  // ---------------------------------------------------------------------------

  describe('create', () => {
    it('legt ein Mitglied an und gibt es zurück', () => {
      const member = repo.create({
        username: 'testuser',
        display_name: 'Test User',
      });

      expect(member.id).toBeGreaterThan(0);
      expect(member.username).toBe('testuser');
      expect(member.display_name).toBe('Test User');
      expect(member.role).toBe('member');
      expect(member.is_active).toBe(1);
      expect(member.password_hash).toBeNull();
    });

    it('kann einen Admin anlegen', () => {
      const admin = repo.create({
        username: 'admin',
        display_name: 'Admin',
        role: 'admin',
      });
      expect(admin.role).toBe('admin');
    });

    it('schlägt bei doppeltem username fehl', () => {
      repo.create({ username: 'dupe', display_name: 'Eins' });
      expect(() => repo.create({ username: 'dupe', display_name: 'Zwei' })).toThrow();
    });

    it('setzt member_status=aktiv und can_book_for_others=0 als Default', () => {
      const member = repo.create({ username: 'defaults', display_name: 'Defaults' });
      expect(member.member_status).toBe('aktiv');
      expect(member.can_book_for_others).toBe(0);
    });

    it('übernimmt member_status und can_book_for_others', () => {
      const member = repo.create({
        username: 'theke',
        display_name: 'Allgemein',
        member_status: 'freund',
        can_book_for_others: 1,
      });
      expect(member.member_status).toBe('freund');
      expect(member.can_book_for_others).toBe(1);
    });

    it('lehnt einen ungültigen member_status ab (CHECK-Constraint)', () => {
      expect(() =>
        repo.create({
          username: 'kaputt',
          display_name: 'Kaputt',
          // @ts-expect-error – absichtlich ungültiger Wert für den DB-CHECK
          member_status: 'unbekannt',
        }),
      ).toThrow();
    });

    it('username-Vergleich ist case-insensitive (UNIQUE COLLATE NOCASE)', () => {
      repo.create({ username: 'Anna', display_name: 'Anna' });
      expect(() => repo.create({ username: 'ANNA', display_name: 'Anna2' })).toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // findById / findByUsername
  // ---------------------------------------------------------------------------

  describe('findById', () => {
    it('gibt undefined zurück wenn nicht gefunden', () => {
      expect(repo.findById(999)).toBeUndefined();
    });

    it('findet ein vorhandenes Mitglied', () => {
      const created = repo.create({ username: 'foo', display_name: 'Foo' });
      expect(repo.findById(created.id)).toMatchObject({ username: 'foo' });
    });
  });

  describe('findByUsername', () => {
    it('gibt undefined zurück wenn nicht gefunden', () => {
      expect(repo.findByUsername('nobody')).toBeUndefined();
    });

    it('findet case-insensitiv', () => {
      repo.create({ username: 'Klaus', display_name: 'Klaus' });
      expect(repo.findByUsername('KLAUS')).toBeDefined();
      expect(repo.findByUsername('klaus')).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // findAll
  // ---------------------------------------------------------------------------

  describe('findAll', () => {
    it('gibt nur aktive Mitglieder zurück (default)', () => {
      const m1 = repo.create({ username: 'aktiv', display_name: 'Aktiv' });
      const m2 = repo.create({ username: 'inaktiv', display_name: 'Inaktiv' });
      repo.deactivate(m2.id);

      const all = repo.findAll();
      expect(all.some((m) => m.id === m1.id)).toBe(true);
      expect(all.some((m) => m.id === m2.id)).toBe(false);
    });

    it('gibt alle Mitglieder zurück wenn includeInactive=true', () => {
      const m = repo.create({ username: 'inaktiv2', display_name: 'Inaktiv2' });
      repo.deactivate(m.id);

      const all = repo.findAll(true);
      expect(all.some((x) => x.id === m.id)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // update
  // ---------------------------------------------------------------------------

  describe('update', () => {
    it('aktualisiert display_name', () => {
      const m = repo.create({ username: 'upd', display_name: 'Alt' });
      const updated = repo.update(m.id, { display_name: 'Neu' });
      expect(updated?.display_name).toBe('Neu');
    });

    it('aktualisiert password_hash', () => {
      const m = repo.create({ username: 'pw', display_name: 'PW' });
      const updated = repo.update(m.id, { password_hash: '$2b$10$fakeHash' });
      expect(updated?.password_hash).toBe('$2b$10$fakeHash');
    });

    it('gibt undefined zurück wenn id nicht existiert', () => {
      expect(repo.update(999, { display_name: 'X' })).toBeUndefined();
    });

    it('lässt nicht angegebene Felder unverändert', () => {
      const m = repo.create({ username: 'partial', display_name: 'Orig', role: 'admin' });
      const updated = repo.update(m.id, { display_name: 'Geändert' });
      expect(updated?.role).toBe('admin');
    });

    it('aktualisiert member_status und can_book_for_others', () => {
      const m = repo.create({ username: 'cat', display_name: 'Kat' });
      const updated = repo.update(m.id, { member_status: 'inaktiv', can_book_for_others: 1 });
      expect(updated?.member_status).toBe('inaktiv');
      expect(updated?.can_book_for_others).toBe(1);
    });

    it('lässt member_status/can_book_for_others unverändert wenn nicht angegeben', () => {
      const m = repo.create({
        username: 'keep',
        display_name: 'Keep',
        member_status: 'alter_herr',
        can_book_for_others: 1,
      });
      const updated = repo.update(m.id, { display_name: 'Neu' });
      expect(updated?.member_status).toBe('alter_herr');
      expect(updated?.can_book_for_others).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------
  // findBookable
  // ---------------------------------------------------------------------------

  describe('findBookable', () => {
    it('liefert nur aktive Members ohne Buchen-für-andere-Recht', () => {
      const aktiv = repo.create({ username: 'a', display_name: 'Aktiv', member_status: 'aktiv' });
      const admin = repo.create({ username: 'adm', display_name: 'Admin', role: 'admin' });
      const theke = repo.create({
        username: 'theke',
        display_name: 'Allgemein',
        can_book_for_others: 1,
      });
      const inaktivKonto = repo.create({ username: 'weg', display_name: 'Weg' });
      repo.deactivate(inaktivKonto.id);

      const ids = repo.findBookable().map((m) => m.id);
      expect(ids).toContain(aktiv.id);
      expect(ids).not.toContain(admin.id);
      expect(ids).not.toContain(theke.id);
      expect(ids).not.toContain(inaktivKonto.id);
    });

    it('sortiert nach Kategorie (Aktive → Inaktive → Alte Herren → Freunde)', () => {
      repo.create({ username: 'f', display_name: 'Freund', member_status: 'freund' });
      repo.create({ username: 'ah', display_name: 'AlterHerr', member_status: 'alter_herr' });
      repo.create({ username: 'ak', display_name: 'Aktiver', member_status: 'aktiv' });
      repo.create({ username: 'in', display_name: 'Inaktiver', member_status: 'inaktiv' });

      const stati = repo.findBookable().map((m) => m.member_status);
      expect(stati).toEqual(['aktiv', 'inaktiv', 'alter_herr', 'freund']);
    });
  });

  // ---------------------------------------------------------------------------
  // deactivate
  // ---------------------------------------------------------------------------

  describe('deactivate', () => {
    it('setzt is_active = 0', () => {
      const m = repo.create({ username: 'gone', display_name: 'Gone' });
      expect(repo.deactivate(m.id)).toBe(true);
      expect(repo.findById(m.id)?.is_active).toBe(0);
    });

    it('gibt false zurück wenn id nicht existiert', () => {
      expect(repo.deactivate(9999)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // email + avatar_path (M10)
  // ---------------------------------------------------------------------------

  describe('create mit email', () => {
    it('speichert eine E-Mail-Adresse', () => {
      const m = repo.create({ username: 'ema', display_name: 'Ema', email: 'ema@example.com' });
      expect(m.email).toBe('ema@example.com');
    });

    it('email ist null wenn nicht angegeben', () => {
      const m = repo.create({ username: 'nomail', display_name: 'No Mail' });
      expect(m.email).toBeNull();
    });

    it('schlägt bei doppelter E-Mail-Adresse fehl (UNIQUE-Index)', () => {
      repo.create({ username: 'e1', display_name: 'Eins', email: 'gleich@example.com' });
      expect(() =>
        repo.create({ username: 'e2', display_name: 'Zwei', email: 'gleich@example.com' }),
      ).toThrow();
    });

    it('E-Mail-Vergleich ist case-insensitive (COLLATE NOCASE)', () => {
      repo.create({ username: 'gross', display_name: 'Gross', email: 'Test@Example.com' });
      expect(() =>
        repo.create({ username: 'klein', display_name: 'Klein', email: 'test@example.com' }),
      ).toThrow();
    });

    it('mehrere NULL-Werte sind erlaubt (partieller Index)', () => {
      repo.create({ username: 'n1', display_name: 'N1', email: null });
      expect(() => repo.create({ username: 'n2', display_name: 'N2', email: null })).not.toThrow();
    });
  });

  describe('findByEmail', () => {
    it('findet ein Mitglied anhand der E-Mail', () => {
      const m = repo.create({ username: 'finde', display_name: 'Finde', email: 'finde@test.de' });
      const found = repo.findByEmail('finde@test.de');
      expect(found?.id).toBe(m.id);
    });

    it('findet case-insensitiv', () => {
      repo.create({ username: 'ci', display_name: 'CI', email: 'ci@test.de' });
      expect(repo.findByEmail('CI@TEST.DE')).toBeDefined();
    });

    it('gibt undefined zurück wenn nicht gefunden', () => {
      expect(repo.findByEmail('niemand@test.de')).toBeUndefined();
    });
  });

  describe('update mit email + avatar_path', () => {
    it('setzt eine E-Mail-Adresse', () => {
      const m = repo.create({ username: 'upde', display_name: 'UpdE' });
      const updated = repo.update(m.id, { email: 'neu@test.de' });
      expect(updated?.email).toBe('neu@test.de');
    });

    it('löscht eine E-Mail-Adresse (null)', () => {
      const m = repo.create({ username: 'del', display_name: 'Del', email: 'del@test.de' });
      const updated = repo.update(m.id, { email: null });
      expect(updated?.email).toBeNull();
    });

    it('lässt email unverändert wenn nicht angegeben', () => {
      const m = repo.create({ username: 'keep2', display_name: 'Keep2', email: 'keep@test.de' });
      const updated = repo.update(m.id, { display_name: 'Neu' });
      expect(updated?.email).toBe('keep@test.de');
    });

    it('setzt und liest avatar_path', () => {
      const m = repo.create({ username: 'av', display_name: 'Av' });
      const updated = repo.update(m.id, { avatar_path: '42.webp' });
      expect(updated?.avatar_path).toBe('42.webp');
    });

    it('löscht avatar_path (null)', () => {
      const m = repo.create({ username: 'avdel', display_name: 'AvDel' });
      repo.update(m.id, { avatar_path: '42.webp' });
      const cleared = repo.update(m.id, { avatar_path: null });
      expect(cleared?.avatar_path).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // email_verified_at (M16)
  // ---------------------------------------------------------------------------

  describe('email_verified_at', () => {
    it('ist standardmäßig NULL', () => {
      const m = repo.create({ username: 'ev1', display_name: 'EV1', email: 'ev1@test.de' });
      expect(m.email_verified_at).toBeNull();
    });

    it('markEmailVerified setzt den Zeitpunkt', () => {
      const m = repo.create({ username: 'ev2', display_name: 'EV2', email: 'ev2@test.de' });
      const verifiedAt = new Date().toISOString();
      repo.markEmailVerified(m.id, verifiedAt);
      expect(repo.findById(m.id)?.email_verified_at).toBe(verifiedAt);
    });

    it('wird bei einer tatsächlichen Änderung der E-Mail-Adresse auf NULL zurückgesetzt', () => {
      const m = repo.create({ username: 'ev3', display_name: 'EV3', email: 'alt@test.de' });
      repo.markEmailVerified(m.id, new Date().toISOString());
      expect(repo.findById(m.id)?.email_verified_at).not.toBeNull();

      const updated = repo.update(m.id, { email: 'neu@test.de' });
      expect(updated?.email_verified_at).toBeNull();
    });

    it('bleibt erhalten, wenn dieselbe E-Mail-Adresse erneut gesetzt wird', () => {
      const m = repo.create({ username: 'ev4', display_name: 'EV4', email: 'gleich@test.de' });
      const verifiedAt = new Date().toISOString();
      repo.markEmailVerified(m.id, verifiedAt);

      const updated = repo.update(m.id, { email: 'gleich@test.de' });
      expect(updated?.email_verified_at).toBe(verifiedAt);
    });

    it('bleibt erhalten, wenn ein anderes Feld geändert wird', () => {
      const m = repo.create({ username: 'ev5', display_name: 'EV5', email: 'ev5@test.de' });
      const verifiedAt = new Date().toISOString();
      repo.markEmailVerified(m.id, verifiedAt);

      const updated = repo.update(m.id, { display_name: 'Neu' });
      expect(updated?.email_verified_at).toBe(verifiedAt);
    });
  });

  // ---------------------------------------------------------------------------
  // Wirtschaftskommission & Streichen (M13)
  // ---------------------------------------------------------------------------

  describe('is_wirtschaftskommission', () => {
    it('ist standardmäßig 0 und wird beim Anlegen übernommen', () => {
      const normal = repo.create({ username: 'n', display_name: 'N' });
      expect(normal.is_wirtschaftskommission).toBe(0);

      const wk = repo.create({
        username: 'wk',
        display_name: 'WK',
        is_wirtschaftskommission: 1,
      });
      expect(wk.is_wirtschaftskommission).toBe(1);
    });

    it('lässt sich per update umschalten', () => {
      const m = repo.create({ username: 'toggle', display_name: 'Toggle' });
      expect(repo.update(m.id, { is_wirtschaftskommission: 1 })?.is_wirtschaftskommission).toBe(1);
      expect(repo.update(m.id, { is_wirtschaftskommission: 0 })?.is_wirtschaftskommission).toBe(0);
    });
  });

  describe('setStruckUntil', () => {
    it('setzt und löscht struck_until', () => {
      const m = repo.create({ username: 'struck', display_name: 'Struck' });
      expect(m.struck_until).toBeNull();

      const until = new Date(Date.now() + 1000).toISOString();
      expect(repo.setStruckUntil(m.id, until)).toBe(true);
      expect(repo.findById(m.id)?.struck_until).toBe(until);

      expect(repo.setStruckUntil(m.id, null)).toBe(true);
      expect(repo.findById(m.id)?.struck_until).toBeNull();
    });

    it('bleibt bei einem update ohne struck_until erhalten', () => {
      const m = repo.create({ username: 'keep', display_name: 'Keep' });
      const until = new Date(Date.now() + 1000).toISOString();
      repo.setStruckUntil(m.id, until);
      repo.update(m.id, { display_name: 'Neu' });
      expect(repo.findById(m.id)?.struck_until).toBe(until);
    });
  });
});
