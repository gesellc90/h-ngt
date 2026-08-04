/**
 * Integrationstests für die Wirtschaftskommission (WK) & Konten-Streichung (M13).
 *
 * Getestete Szenarien:
 *  - POST /members/:id/strike:   WK darf (200), Admin darf (200), Member nicht (403),
 *                                Theken-Konto nicht streichbar (409), setzt struck_until ~2 Wochen
 *  - POST /members/:id/unstrike: entstreichen (200), nicht gestrichen → 409 NOT_STRUCK
 *  - GET  /members/strikeable:   WK/Admin dürfen (200, inkl. gestrichener), Member nicht (403)
 *  - POST /bookings:             gestrichenes Konto blockiert Selbst- und Theken-Buchung (409),
 *                                Zeiger-Buchung bleibt erlaubt, abgelaufene Streichung wieder erlaubt
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
import { ZeigerRepo } from '../../src/db/repos/ZeigerRepo.js';
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

interface TestContext {
  app: Express;
  db: Db;
  membersRepo: MembersRepo;
  adminToken: string;
  wkToken: string;
  aliceToken: string;
  allgemeinToken: string;
  aliceId: number;
  allgemeinId: number;
  drinkId: number;
  zeigerId: number;
}

async function getToken(app: Express, username: string, password = 'geheim123'): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ username, password });
  return res.body.token as string;
}

async function setupApp(): Promise<TestContext> {
  const db = createTestDb();
  const membersRepo = new MembersRepo(db);
  const drinksRepo = new DrinksRepo(db);
  const zeigerRepo = new ZeigerRepo(db);
  const passwordHash = await bcrypt.hash('geheim123', 10);

  membersRepo.create({
    username: 'admin',
    display_name: 'Administrator',
    password_hash: passwordHash,
    role: 'admin',
  });
  membersRepo.create({
    username: 'wiko',
    display_name: 'Wirtschaftskommission',
    password_hash: passwordHash,
    role: 'member',
    is_wirtschaftskommission: 1,
  });
  const alice = membersRepo.create({
    username: 'alice',
    display_name: 'Alice Muster',
    password_hash: passwordHash,
    role: 'member',
  });
  const allgemein = membersRepo.create({
    username: 'allgemein',
    display_name: 'Allgemein',
    password_hash: passwordHash,
    role: 'member',
    can_book_for_others: 1,
  });

  const drink = drinksRepo.create({ name: 'Cola', categoryId: 1, initialPriceCents: 150 });
  const zeiger = zeigerRepo.create({
    titel: 'Stiftungsfest',
    art: 'veranstaltung',
    created_by: alice.id,
  });

  const app = createApp({ logger: silentLogger, db, env: testEnv });

  const [adminToken, wkToken, aliceToken, allgemeinToken] = await Promise.all([
    getToken(app, 'admin'),
    getToken(app, 'wiko'),
    getToken(app, 'alice'),
    getToken(app, 'allgemein'),
  ]);

  return {
    app,
    db,
    membersRepo,
    adminToken,
    wkToken,
    aliceToken,
    allgemeinToken,
    aliceId: alice.id,
    allgemeinId: allgemein.id,
    drinkId: drink.id,
    zeigerId: zeiger.id,
  };
}

// ---------------------------------------------------------------------------
// POST /members/:id/strike
// ---------------------------------------------------------------------------

describe('POST /api/v1/members/:id/strike', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('lässt die WK ein Konto streichen und setzt struck_until ~2 Wochen', async () => {
    const before = Date.now();
    const res = await request(ctx.app)
      .post(`/api/v1/members/${ctx.aliceId}/strike`)
      .set('Authorization', `Bearer ${ctx.wkToken}`);

    expect(res.status).toBe(200);
    expect(res.body.struck_until).not.toBeNull();
    const until = new Date(res.body.struck_until).getTime();
    const expected = before + 14 * 24 * 60 * 60 * 1000;
    // Toleranz von ein paar Sekunden für die Testlaufzeit.
    expect(Math.abs(until - expected)).toBeLessThan(10_000);
  });

  it('lässt auch einen Admin streichen', async () => {
    const res = await request(ctx.app)
      .post(`/api/v1/members/${ctx.aliceId}/strike`)
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(res.status).toBe(200);
  });

  it('verbietet einem normalen Mitglied das Streichen (403)', async () => {
    const res = await request(ctx.app)
      .post(`/api/v1/members/${ctx.aliceId}/strike`)
      .set('Authorization', `Bearer ${ctx.aliceToken}`);
    expect(res.status).toBe(403);
  });

  it('verweigert das Streichen eines Theken-Kontos (409 NOT_STRIKEABLE)', async () => {
    const res = await request(ctx.app)
      .post(`/api/v1/members/${ctx.allgemeinId}/strike`)
      .set('Authorization', `Bearer ${ctx.wkToken}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_STRIKEABLE');
  });

  it('antwortet 401 ohne Token', async () => {
    const res = await request(ctx.app).post(`/api/v1/members/${ctx.aliceId}/strike`);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /members/:id/unstrike
// ---------------------------------------------------------------------------

describe('POST /api/v1/members/:id/unstrike', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('entstreicht ein gestrichenes Konto vorzeitig', async () => {
    await request(ctx.app)
      .post(`/api/v1/members/${ctx.aliceId}/strike`)
      .set('Authorization', `Bearer ${ctx.wkToken}`);

    const res = await request(ctx.app)
      .post(`/api/v1/members/${ctx.aliceId}/unstrike`)
      .set('Authorization', `Bearer ${ctx.wkToken}`);

    expect(res.status).toBe(200);
    expect(res.body.struck_until).toBeNull();
  });

  it('antwortet 409 NOT_STRUCK, wenn das Konto nicht gestrichen ist', async () => {
    const res = await request(ctx.app)
      .post(`/api/v1/members/${ctx.aliceId}/unstrike`)
      .set('Authorization', `Bearer ${ctx.wkToken}`);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('NOT_STRUCK');
  });
});

// ---------------------------------------------------------------------------
// GET /members/strikeable
// ---------------------------------------------------------------------------

describe('GET /api/v1/members/strikeable', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('liefert der WK die streichbaren Konten inkl. gestrichener', async () => {
    await request(ctx.app)
      .post(`/api/v1/members/${ctx.aliceId}/strike`)
      .set('Authorization', `Bearer ${ctx.wkToken}`);

    const res = await request(ctx.app)
      .get('/api/v1/members/strikeable')
      .set('Authorization', `Bearer ${ctx.wkToken}`);

    expect(res.status).toBe(200);
    const alice = res.body.find((m: { id: number }) => m.id === ctx.aliceId);
    expect(alice).toBeDefined();
    expect(alice.struck_until).not.toBeNull();
    // Theken-Konto ist nicht streichbar und taucht nicht auf.
    expect(res.body.some((m: { id: number }) => m.id === ctx.allgemeinId)).toBe(false);
  });

  it('verbietet einem normalen Mitglied den Zugriff (403)', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/members/strikeable')
      .set('Authorization', `Bearer ${ctx.aliceToken}`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /bookings — Streich-Sperre
// ---------------------------------------------------------------------------

describe('POST /api/v1/bookings — gestrichenes Konto', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  async function strikeAlice(): Promise<void> {
    await request(ctx.app)
      .post(`/api/v1/members/${ctx.aliceId}/strike`)
      .set('Authorization', `Bearer ${ctx.wkToken}`);
  }

  it('blockiert die Selbstbuchung eines gestrichenen Kontos (409 MEMBER_STRUCK)', async () => {
    await strikeAlice();
    const res = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ drink_id: ctx.drinkId });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MEMBER_STRUCK');
  });

  it('blockiert die Theken-Buchung auf ein gestrichenes Konto (409)', async () => {
    await strikeAlice();
    const res = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.allgemeinToken}`)
      .send({ drink_id: ctx.drinkId, member_id: ctx.aliceId });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('MEMBER_STRUCK');
  });

  it('erlaubt eine Zeiger-Buchung trotz gestrichenem Konto', async () => {
    await strikeAlice();
    const res = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ drink_id: ctx.drinkId, zeiger_id: ctx.zeigerId });
    expect(res.status).toBe(201);
  });

  it('erlaubt die Buchung wieder, sobald die Streichung abgelaufen ist', async () => {
    // Streichung in der Vergangenheit setzen (abgelaufen).
    const past = new Date(Date.now() - 60_000).toISOString();
    ctx.membersRepo.setStruckUntil(ctx.aliceId, past);

    const res = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ drink_id: ctx.drinkId });
    expect(res.status).toBe(201);
  });
});
