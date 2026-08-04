/**
 * Integrationstests für den /reports-Endpunkt.
 *
 * Getestete Szenarien:
 *  - GET /reports/monthly?format=csv:  200 + korrekter Content-Type + UTF-8-BOM + Inhalt
 *  - GET /reports/monthly?format=pdf:  200 + Content-Type application/pdf + %PDF-Header + Mindestgröße
 *  - GET /reports/all?format=pdf:      200 + PDF-Header
 *  - 401 ohne Token
 *  - 403 als Member
 *  - 400 bei ungültigen Query-Params
 *  - 404 bei unbekanntem memberId
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
import { BookingsRepo } from '../../src/db/repos/BookingsRepo.js';
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
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

interface TestContext {
  app: Express;
  db: Db;
  adminToken: string;
  memberToken: string;
  memberId: number;
}

async function setupApp(): Promise<TestContext> {
  const db = createTestDb();
  const membersRepo = new MembersRepo(db);
  const drinksRepo = new DrinksRepo(db);
  const bookingsRepo = new BookingsRepo(db);
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
  });
  const cola = drinksRepo.create({ name: 'Cola', categoryId: 1, initialPriceCents: 120 });

  // 2 Buchungen für alice im aktuellen Monat (Timestamp wird von SQLite auf NOW gesetzt)
  bookingsRepo.create({ member_id: alice.id, drink_id: cola.id, price_cents_snapshot: 120 });
  bookingsRepo.create({ member_id: alice.id, drink_id: cola.id, price_cents_snapshot: 120 });

  const app = createApp({ logger: silentLogger, db, env: testEnv });

  // Token via Login holen
  const adminLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ username: 'admin', password: 'geheim123' });
  const memberLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ username: 'alice', password: 'geheim123' });

  return {
    app,
    db,
    adminToken: (adminLogin.body as { token: string }).token,
    memberToken: (memberLogin.body as { token: string }).token,
    memberId: alice.id,
  };
}

// Jahr/Monat in der Report-Zeitzone (Europe/Berlin) ermitteln – konsistent zu
// den Berliner Monatsgrenzen im ReportService. Sonst könnte am Monatsende ein
// per NOW gebuchter Eintrag knapp in den Nachbarmonat fallen (Flaky-Test).
const berlinNowParts = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Berlin',
  year: 'numeric',
  month: 'numeric',
}).formatToParts(new Date());
const CURRENT_YEAR = Number(berlinNowParts.find((p) => p.type === 'year')!.value);
const CURRENT_MONTH = Number(berlinNowParts.find((p) => p.type === 'month')!.value);

// ---------------------------------------------------------------------------
// Auth-Tests
// ---------------------------------------------------------------------------

describe('GET /api/v1/reports/monthly — Auth', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('gibt 401 ohne Token zurück', async () => {
    const res = await request(ctx.app).get(
      `/api/v1/reports/monthly?memberId=${ctx.memberId}&year=${CURRENT_YEAR}&month=${CURRENT_MONTH}&format=csv`,
    );
    expect(res.status).toBe(401);
  });

  it('gibt 403 als Member zurück', async () => {
    const res = await request(ctx.app)
      .get(
        `/api/v1/reports/monthly?memberId=${ctx.memberId}&year=${CURRENT_YEAR}&month=${CURRENT_MONTH}&format=csv`,
      )
      .set('Authorization', `Bearer ${ctx.memberToken}`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Validierungs-Tests
// ---------------------------------------------------------------------------

describe('GET /api/v1/reports/monthly — Validierung', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('gibt 400 zurück wenn memberId fehlt', async () => {
    const res = await request(ctx.app)
      .get(`/api/v1/reports/monthly?year=${CURRENT_YEAR}&month=${CURRENT_MONTH}&format=csv`)
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(res.status).toBe(400);
  });

  it('gibt 400 zurück bei ungültigem Format', async () => {
    const res = await request(ctx.app)
      .get(
        `/api/v1/reports/monthly?memberId=${ctx.memberId}&year=${CURRENT_YEAR}&month=${CURRENT_MONTH}&format=xlsx`,
      )
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(res.status).toBe(400);
  });

  it('gibt 400 zurück bei month=13', async () => {
    const res = await request(ctx.app)
      .get(
        `/api/v1/reports/monthly?memberId=${ctx.memberId}&year=${CURRENT_YEAR}&month=13&format=csv`,
      )
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(res.status).toBe(400);
  });

  it('gibt 404 zurück bei unbekannter memberId', async () => {
    const res = await request(ctx.app)
      .get(
        `/api/v1/reports/monthly?memberId=99999&year=${CURRENT_YEAR}&month=${CURRENT_MONTH}&format=csv`,
      )
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// CSV-Export
// ---------------------------------------------------------------------------

describe('GET /api/v1/reports/monthly?format=csv', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('gibt 200 mit korrektem Content-Type zurück', async () => {
    const res = await request(ctx.app)
      .get(
        `/api/v1/reports/monthly?memberId=${ctx.memberId}&year=${CURRENT_YEAR}&month=${CURRENT_MONTH}&format=csv`,
      )
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
  });

  it('enthält UTF-8-BOM als erstes Zeichen', async () => {
    const res = await request(ctx.app)
      .get(
        `/api/v1/reports/monthly?memberId=${ctx.memberId}&year=${CURRENT_YEAR}&month=${CURRENT_MONTH}&format=csv`,
      )
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    const body = res.body as Buffer;
    // UTF-8-BOM: EF BB BF
    expect(body[0]).toBe(0xef);
    expect(body[1]).toBe(0xbb);
    expect(body[2]).toBe(0xbf);
  });

  it('enthält Getränkenamen und Beträge im CSV-Inhalt', async () => {
    const res = await request(ctx.app)
      .get(
        `/api/v1/reports/monthly?memberId=${ctx.memberId}&year=${CURRENT_YEAR}&month=${CURRENT_MONTH}&format=csv`,
      )
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    const text = res.text;
    expect(text).toContain('Cola');
    expect(text).toContain('1,20'); // 120 Cent → "1,20"
    expect(text).toContain('Alice'); // Mitgliedsname im Titel
  });

  it('gibt Content-Disposition mit .csv-Dateiname zurück', async () => {
    const res = await request(ctx.app)
      .get(
        `/api/v1/reports/monthly?memberId=${ctx.memberId}&year=${CURRENT_YEAR}&month=${CURRENT_MONTH}&format=csv`,
      )
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    expect(res.headers['content-disposition']).toMatch(/\.csv"/);
  });
});

// ---------------------------------------------------------------------------
// PDF-Export
// ---------------------------------------------------------------------------

describe('GET /api/v1/reports/monthly?format=pdf', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('gibt 200 mit Content-Type application/pdf zurück', async () => {
    const res = await request(ctx.app)
      .get(
        `/api/v1/reports/monthly?memberId=${ctx.memberId}&year=${CURRENT_YEAR}&month=${CURRENT_MONTH}&format=pdf`,
      )
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/pdf/);
  });

  it('PDF beginnt mit dem %PDF-Magic-Byte', async () => {
    const res = await request(ctx.app)
      .get(
        `/api/v1/reports/monthly?memberId=${ctx.memberId}&year=${CURRENT_YEAR}&month=${CURRENT_MONTH}&format=pdf`,
      )
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    const body = res.body as Buffer;
    expect(body.length).toBeGreaterThan(1000); // Mindestgröße
    expect(body.slice(0, 4).toString('ascii')).toBe('%PDF');
  });
});

// ---------------------------------------------------------------------------
// Sammel-PDF
// ---------------------------------------------------------------------------

describe('GET /api/v1/reports/all?format=pdf', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('gibt 401 ohne Token zurück', async () => {
    const res = await request(ctx.app).get(
      `/api/v1/reports/all?year=${CURRENT_YEAR}&month=${CURRENT_MONTH}&format=pdf`,
    );
    expect(res.status).toBe(401);
  });

  it('gibt 200 mit %PDF-Header zurück', async () => {
    const res = await request(ctx.app)
      .get(`/api/v1/reports/all?year=${CURRENT_YEAR}&month=${CURRENT_MONTH}&format=pdf`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => callback(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    const body = res.body as Buffer;
    expect(body.slice(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('gibt 400 bei fehlendem format zurück', async () => {
    const res = await request(ctx.app)
      .get(`/api/v1/reports/all?year=${CURRENT_YEAR}&month=${CURRENT_MONTH}`)
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(res.status).toBe(400);
  });
});
