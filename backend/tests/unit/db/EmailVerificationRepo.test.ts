import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Db } from '../../../src/db/client.js';
import { MembersRepo } from '../../../src/db/repos/MembersRepo.js';
import { EmailVerificationRepo } from '../../../src/db/repos/EmailVerificationRepo.js';
import { createTestDb } from './helpers.js';

describe('EmailVerificationRepo', () => {
  let db: Db;
  let repo: EmailVerificationRepo;
  let memberId: number;

  beforeEach(() => {
    db = createTestDb();
    repo = new EmailVerificationRepo(db);
    const membersRepo = new MembersRepo(db);
    memberId = membersRepo.create({
      username: 'alice',
      display_name: 'Alice',
      email: 'alice@example.org',
    }).id;
  });

  afterEach(() => {
    db.close();
  });

  it('legt einen Token an und gibt ihn zurück', () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const row = repo.create({
      member_id: memberId,
      email: 'alice@example.org',
      token_hash: 'hash-1',
      expires_at: expiresAt,
    });

    expect(row.id).toBeGreaterThan(0);
    expect(row.member_id).toBe(memberId);
    expect(row.email).toBe('alice@example.org');
    expect(row.token_hash).toBe('hash-1');
    expect(row.used_at).toBeNull();
  });

  it('schlägt bei doppeltem token_hash fehl (UNIQUE)', () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    repo.create({
      member_id: memberId,
      email: 'alice@example.org',
      token_hash: 'dupe',
      expires_at: expiresAt,
    });
    expect(() =>
      repo.create({
        member_id: memberId,
        email: 'alice@example.org',
        token_hash: 'dupe',
        expires_at: expiresAt,
      }),
    ).toThrow();
  });

  describe('findByTokenHash', () => {
    it('findet einen vorhandenen Token', () => {
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      repo.create({
        member_id: memberId,
        email: 'alice@example.org',
        token_hash: 'find-me',
        expires_at: expiresAt,
      });
      expect(repo.findByTokenHash('find-me')).toBeDefined();
    });

    it('gibt undefined zurück wenn nicht gefunden', () => {
      expect(repo.findByTokenHash('nichts')).toBeUndefined();
    });
  });

  describe('markUsed', () => {
    it('setzt used_at', () => {
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      const row = repo.create({
        member_id: memberId,
        email: 'alice@example.org',
        token_hash: 'to-use',
        expires_at: expiresAt,
      });
      expect(row.used_at).toBeNull();

      repo.markUsed(row.id);
      const reloaded = repo.findByTokenHash('to-use');
      expect(reloaded?.used_at).not.toBeNull();
    });
  });

  describe('invalidateOpenForMember', () => {
    it('entwertet alle offenen Tokens eines Mitglieds', () => {
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      repo.create({
        member_id: memberId,
        email: 'alice@example.org',
        token_hash: 'a',
        expires_at: expiresAt,
      });
      repo.create({
        member_id: memberId,
        email: 'alice@example.org',
        token_hash: 'b',
        expires_at: expiresAt,
      });

      repo.invalidateOpenForMember(memberId);

      expect(repo.findByTokenHash('a')?.used_at).not.toBeNull();
      expect(repo.findByTokenHash('b')?.used_at).not.toBeNull();
    });

    it('lässt bereits eingelöste Tokens unverändert (kein doppeltes used_at-Update nötig)', () => {
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      const row = repo.create({
        member_id: memberId,
        email: 'alice@example.org',
        token_hash: 'already-used',
        expires_at: expiresAt,
      });
      repo.markUsed(row.id);
      const usedAtBefore = repo.findByTokenHash('already-used')?.used_at;

      repo.invalidateOpenForMember(memberId);

      expect(repo.findByTokenHash('already-used')?.used_at).toBe(usedAtBefore);
    });

    it('betrifft nur Tokens des angegebenen Mitglieds', () => {
      const membersRepo = new MembersRepo(db);
      const bobId = membersRepo.create({
        username: 'bob',
        display_name: 'Bob',
        email: 'bob@example.org',
      }).id;
      const expiresAt = new Date(Date.now() + 60_000).toISOString();
      repo.create({
        member_id: memberId,
        email: 'alice@example.org',
        token_hash: 'alice-token',
        expires_at: expiresAt,
      });
      repo.create({
        member_id: bobId,
        email: 'bob@example.org',
        token_hash: 'bob-token',
        expires_at: expiresAt,
      });

      repo.invalidateOpenForMember(memberId);

      expect(repo.findByTokenHash('alice-token')?.used_at).not.toBeNull();
      expect(repo.findByTokenHash('bob-token')?.used_at).toBeNull();
    });
  });

  describe('pruneExpired', () => {
    it('löscht nur abgelaufene Tokens', () => {
      const past = new Date(Date.now() - 60_000).toISOString();
      const future = new Date(Date.now() + 60_000).toISOString();
      repo.create({
        member_id: memberId,
        email: 'alice@example.org',
        token_hash: 'abgelaufen',
        expires_at: past,
      });
      repo.create({
        member_id: memberId,
        email: 'alice@example.org',
        token_hash: 'gueltig',
        expires_at: future,
      });

      const deleted = repo.pruneExpired();

      expect(deleted).toBe(1);
      expect(repo.findByTokenHash('abgelaufen')).toBeUndefined();
      expect(repo.findByTokenHash('gueltig')).toBeDefined();
    });
  });
});
