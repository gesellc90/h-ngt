/**
 * Integrationstests für die E-Mail-Verifizierung (M16).
 *
 *  - POST /auth/verify-email:            200 Erfolg, 400 ungültiger/unbekannter Token,
 *                                         410 abgelaufen, 409 bereits benutzt / Adresse geändert
 *  - POST /auth/me/verify-email/resend:  401 ohne Token, 503 MAIL_DISABLED
 *  - PATCH /auth/me und PATCH /members/:id: setzen email_verified_at zurück und
 *    stellen automatisch einen neuen Token aus
 *
 * MAIL_ENABLED=false in dieser Suite (kein echter SMTP-Server verfügbar,
 * analog zu tests/integration/mail.test.ts) — Tokens für den Erfolgsfall von
 * POST /auth/verify-email werden deshalb direkt in der Test-DB angelegt statt
 * über eine tatsächlich verschickte Mail eingesammelt zu werden.
 */

import crypto from 'node:crypto';
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { createTestDb } from '../unit/db/helpers.js';
import { MembersRepo } from '../../src/db/repos/MembersRepo.js';
import type { Db } from '../../src/db/client.js';

const silentLogger = pino({ level: 'silent' });
const TEST_JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';

const testEnv = {
  NODE_ENV: 'test' as const,
  PORT: 3001,
  LOG_LEVEL: 'silent' as const,
  DB_PATH: ':memory:',
  JWT_SECRET: TEST_JWT_SECRET,
  JWT_EXPIRES_IN: '8h',
  AVATAR_DIR: '/tmp',
  UPDATE_STATE_DIR: '/tmp',
  TRUST_PROXY: 0,
  MAIL_ENABLED: false,
  SMTP_HOST: 'sslout.df.eu',
  SMTP_PORT: 465,
  SMTP_SECURE: true,
  SMTP_USER: '',
  SMTP_PASS: '',
  MAIL_FROM: '',
  MAIL_SUMMARY_TO: '',
  MAIL_SUMMARY_CC: '',
  MAIL_SCHEDULE_ENABLED: false,
  MAIL_SCHEDULE_HOUR: 3,
  APP_BASE_URL: 'http://localhost:3001',
};

interface TestContext {
  app: Express;
  db: Db;
  adminToken: string;
  aliceToken: string;
  aliceId: number;
}

async function setupApp(): Promise<TestContext> {
  const db = createTestDb();
  const membersRepo = new MembersRepo(db);
  const hash = await bcrypt.hash('geheim123', 10);

  membersRepo.create({
    username: 'admin',
    display_name: 'Admin',
    password_hash: hash,
    role: 'admin',
  });
  const alice = membersRepo.create({
    username: 'alice',
    display_name: 'Alice',
    password_hash: hash,
    email: 'alice@example.org',
  });

  const app = createApp({ logger: silentLogger, db, env: testEnv });

  const adminLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ username: 'admin', password: 'geheim123' });
  const aliceLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ username: 'alice', password: 'geheim123' });

  return {
    app,
    db,
    adminToken: adminLogin.body.token as string,
    aliceToken: aliceLogin.body.token as string,
    aliceId: alice.id,
  };
}

/** Legt direkt einen Verifizierungs-Token in der Test-DB an und gibt den Klartext-Token zurück. */
function seedToken(
  db: Db,
  memberId: number,
  email: string,
  opts: { expired?: boolean; used?: boolean } = {},
): string {
  const tokenPlain = crypto.randomBytes(32).toString('base64url');
  const tokenHash = crypto.createHash('sha256').update(tokenPlain).digest('hex');
  const expiresAt = new Date(
    Date.now() + (opts.expired ? -60_000 : 24 * 60 * 60 * 1000),
  ).toISOString();
  const usedAt = opts.used ? new Date().toISOString() : null;

  db.prepare(
    `INSERT INTO email_verifications (member_id, email, token_hash, expires_at, used_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(memberId, email, tokenHash, expiresAt, usedAt);

  return tokenPlain;
}

let ctx: TestContext;
beforeEach(async () => {
  ctx = await setupApp();
});

// ---------------------------------------------------------------------------
// POST /auth/verify-email
// ---------------------------------------------------------------------------

describe('POST /api/v1/auth/verify-email', () => {
  it('verifiziert bei gültigem Token (200) und setzt email_verified_at', async () => {
    const token = seedToken(ctx.db, ctx.aliceId, 'alice@example.org');

    const res = await request(ctx.app).post('/api/v1/auth/verify-email').send({ token });

    expect(res.status).toBe(200);
    expect(res.body.email_verified_at).not.toBeNull();
  });

  it('gibt 400 bei leerem Body zurück', async () => {
    const res = await request(ctx.app).post('/api/v1/auth/verify-email').send({});
    expect(res.status).toBe(400);
  });

  it('gibt 400 TOKEN_INVALID bei unbekanntem Token zurück', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/auth/verify-email')
      .send({ token: 'unbekannt' });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TOKEN_INVALID');
  });

  it('gibt 410 TOKEN_EXPIRED bei abgelaufenem Token zurück', async () => {
    const token = seedToken(ctx.db, ctx.aliceId, 'alice@example.org', { expired: true });

    const res = await request(ctx.app).post('/api/v1/auth/verify-email').send({ token });

    expect(res.status).toBe(410);
    expect(res.body.code).toBe('TOKEN_EXPIRED');
  });

  it('gibt 409 TOKEN_USED bei bereits benutztem Token zurück', async () => {
    const token = seedToken(ctx.db, ctx.aliceId, 'alice@example.org', { used: true });

    const res = await request(ctx.app).post('/api/v1/auth/verify-email').send({ token });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('TOKEN_USED');
  });

  it('gibt 409 EMAIL_CHANGED zurück, wenn sich die Adresse seit Ausstellung geändert hat', async () => {
    const token = seedToken(ctx.db, ctx.aliceId, 'alte-adresse@example.org');

    const res = await request(ctx.app).post('/api/v1/auth/verify-email').send({ token });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_CHANGED');
  });

  it('ist unauthentifiziert erreichbar (kein Authorization-Header nötig)', async () => {
    const token = seedToken(ctx.db, ctx.aliceId, 'alice@example.org');
    const res = await request(ctx.app).post('/api/v1/auth/verify-email').send({ token });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/me/verify-email/resend
// ---------------------------------------------------------------------------

describe('POST /api/v1/auth/me/verify-email/resend', () => {
  it('gibt 401 ohne Token zurück', async () => {
    const res = await request(ctx.app).post('/api/v1/auth/me/verify-email/resend');
    expect(res.status).toBe(401);
  });

  it('gibt 503 MAIL_DISABLED zurück, wenn MAIL_ENABLED=false ist', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/auth/me/verify-email/resend')
      .set('Authorization', `Bearer ${ctx.aliceToken}`);

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('MAIL_DISABLED');
  });
});

// ---------------------------------------------------------------------------
// Auslöser: PATCH /auth/me und PATCH /members/:id setzen email_verified_at
// zurück und stellen automatisch einen neuen Token aus.
// ---------------------------------------------------------------------------

describe('Automatischer Trigger bei Adressänderung', () => {
  it('PATCH /auth/me: setzt email_verified_at zurück und legt einen neuen Token an', async () => {
    // Erst verifizieren…
    const token = seedToken(ctx.db, ctx.aliceId, 'alice@example.org');
    await request(ctx.app).post('/api/v1/auth/verify-email').send({ token });
    const verified = ctx.db
      .prepare('SELECT email_verified_at FROM members WHERE id = ?')
      .get(ctx.aliceId) as { email_verified_at: string | null };
    expect(verified.email_verified_at).not.toBeNull();

    // …dann die Adresse ändern.
    const res = await request(ctx.app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ email: 'neue-adresse@example.org' });

    expect(res.status).toBe(200);
    expect(res.body.email_verified_at).toBeNull();

    const tokenRows = ctx.db
      .prepare('SELECT * FROM email_verifications WHERE member_id = ? AND used_at IS NULL')
      .all(ctx.aliceId);
    expect(tokenRows).toHaveLength(1);
  });

  it('PATCH /members/:id (Admin): setzt email_verified_at zurück und legt einen neuen Token an', async () => {
    const res = await request(ctx.app)
      .patch(`/api/v1/members/${ctx.aliceId}`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ email: 'admin-gesetzt@example.org' });

    expect(res.status).toBe(200);
    expect(res.body.email_verified_at).toBeNull();

    const tokenRows = ctx.db
      .prepare('SELECT * FROM email_verifications WHERE member_id = ? AND used_at IS NULL')
      .all(ctx.aliceId);
    expect(tokenRows).toHaveLength(1);
  });

  it('setzt beim erneuten Setzen derselben Adresse keinen neuen Token auf (kein tatsächlicher Wechsel)', async () => {
    const res = await request(ctx.app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ email: 'alice@example.org' });

    expect(res.status).toBe(200);
    const tokenRows = ctx.db
      .prepare('SELECT * FROM email_verifications WHERE member_id = ?')
      .all(ctx.aliceId);
    expect(tokenRows).toHaveLength(0);
  });
});
