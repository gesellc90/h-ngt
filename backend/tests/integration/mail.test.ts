/**
 * Integrationstests für den /mail-Endpunkt (M15 — automatischer
 * Monatsabrechnungs-Versand).
 *
 * Der eigentliche Versand (SMTP, Anhänge, Idempotenz) ist bereits ausführlich
 * in tests/unit/services/BillingMailService.test.ts gegen einen gefakten
 * MailService abgedeckt. Hier geht es um Routing, Auth und Validierung — die
 * Test-Umgebung läuft bewusst mit MAIL_ENABLED=false (kein echter SMTP-Server
 * verfügbar), was auch den 503-Pfad testbar macht.
 *
 * Getestete Szenarien:
 *  - GET  /mail/status:      200 Admin, 403 Member, 401 ohne Token
 *  - POST /mail/test:        503 MAIL_DISABLED (MAIL_ENABLED=false), 400 bei ungültiger Adresse
 *  - GET  /mail/preview:     200 mit Plan (funktioniert auch ohne SMTP), 400 bei ungültigen Parametern
 *  - POST /mail/dispatch:    503 MAIL_DISABLED, 403 Member
 *  - GET  /mail/dispatches:  200 mit (leerem) Protokoll
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { createTestDb } from '../unit/db/helpers.js';
import { MembersRepo } from '../../src/db/repos/MembersRepo.js';
import { DrinksRepo } from '../../src/db/repos/DrinksRepo.js';
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
};

interface TestContext {
  app: Express;
  db: Db;
  adminToken: string;
  memberToken: string;
  aliceId: number;
}

async function setupApp(): Promise<TestContext> {
  const db = createTestDb();
  const membersRepo = new MembersRepo(db);
  const drinksRepo = new DrinksRepo(db);
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
  const cola = drinksRepo.create({ name: 'Cola', categoryId: 1, initialPriceCents: 120 });
  db.prepare(
    `INSERT INTO bookings (member_id, drink_id, price_cents_snapshot, booked_at)
     VALUES (?, ?, ?, ?)`,
  ).run(alice.id, cola.id, 120, '2026-05-10T12:00:00.000Z');

  const app = createApp({ logger: silentLogger, db, env: testEnv });

  const adminLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ username: 'admin', password: 'geheim123' });
  const memberLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ username: 'alice', password: 'geheim123' });

  return {
    app,
    db,
    adminToken: adminLogin.body.token as string,
    memberToken: memberLogin.body.token as string,
    aliceId: alice.id,
  };
}

let ctx: TestContext;
beforeEach(async () => {
  ctx = await setupApp();
});

// ---------------------------------------------------------------------------
// GET /mail/status
// ---------------------------------------------------------------------------

describe('GET /api/v1/mail/status', () => {
  it('gibt die Konfiguration ohne Zugangsdaten zurück (200, Admin)', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/mail/status')
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      enabled: false,
      scheduleEnabled: false,
      scheduleHour: 3,
      smtpHost: 'sslout.df.eu',
      summaryTo: null,
      summaryCc: [],
    });
    expect(JSON.stringify(res.body)).not.toContain('SMTP_PASS');
  });

  it('gibt 403 als Member', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/mail/status')
      .set('Authorization', `Bearer ${ctx.memberToken}`);
    expect(res.status).toBe(403);
  });

  it('gibt 401 ohne Token', async () => {
    const res = await request(ctx.app).get('/api/v1/mail/status');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /mail/test
// ---------------------------------------------------------------------------

describe('POST /api/v1/mail/test', () => {
  it('gibt 503 MAIL_DISABLED, wenn MAIL_ENABLED=false ist', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/mail/test')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ to: 'admin@example.org' });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('MAIL_DISABLED');
  });

  it('gibt 400 bei ungültiger E-Mail-Adresse', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/mail/test')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ to: 'keine-email' });
    expect(res.status).toBe(400);
  });

  it('gibt 403 als Member', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/mail/test')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ to: 'admin@example.org' });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /mail/preview  (funktioniert auch mit MAIL_ENABLED=false — reiner Dry-Run)
// ---------------------------------------------------------------------------

describe('GET /api/v1/mail/preview', () => {
  it('berechnet den Versandplan, ohne SMTP zu benötigen (200, Admin)', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/mail/preview')
      .query({ year: '2026', month: '5' })
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.period).toBe('2026-05');
    const aliceLine = res.body.lines.find(
      (l: { kind: string; memberId: number | null }) =>
        l.kind === 'member' && l.memberId === ctx.aliceId,
    );
    expect(aliceLine).toMatchObject({ status: 'planned', recipient: 'alice@example.org' });
    const summaryLine = res.body.lines.find((l: { kind: string }) => l.kind === 'summary');
    expect(summaryLine.status).toBe('planned');
  });

  it('gibt 400 bei ungültigem Monat', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/mail/preview')
      .query({ year: '2026', month: '13' })
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(res.status).toBe(400);
  });

  it('gibt 403 als Member', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/mail/preview')
      .query({ year: '2026', month: '5' })
      .set('Authorization', `Bearer ${ctx.memberToken}`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /mail/dispatch
// ---------------------------------------------------------------------------

describe('POST /api/v1/mail/dispatch', () => {
  it('gibt 503 MAIL_DISABLED, wenn MAIL_ENABLED=false ist', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/mail/dispatch')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ year: 2026, month: 5 });

    expect(res.status).toBe(503);
    expect(res.body.code).toBe('MAIL_DISABLED');
  });

  it('gibt 400 bei ungültigem Body', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/mail/dispatch')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ year: 2026, month: 13 });
    expect(res.status).toBe(400);
  });

  it('gibt 403 als Member', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/mail/dispatch')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ year: 2026, month: 5 });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /mail/dispatches
// ---------------------------------------------------------------------------

describe('GET /api/v1/mail/dispatches', () => {
  it('gibt ein leeres Protokoll zurück, wenn noch nichts versendet wurde (200, Admin)', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/mail/dispatches')
      .query({ year: '2026', month: '5' })
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('gibt 403 als Member', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/mail/dispatches')
      .query({ year: '2026', month: '5' })
      .set('Authorization', `Bearer ${ctx.memberToken}`);
    expect(res.status).toBe(403);
  });

  it('gibt 401 ohne Token', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/mail/dispatches')
      .query({ year: '2026', month: '5' });
    expect(res.status).toBe(401);
  });
});
