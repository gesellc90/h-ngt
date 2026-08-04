/**
 * Integrationstests für die Bookings-Endpunkte.
 *
 * Getestete Szenarien:
 *  - POST /bookings:          Buchung anlegen (happy path), Preis-Snapshot bleibt bei
 *                             Preisänderung erhalten, deaktiviertes Getränk (409),
 *                             unbekanntes Getränk (404), 401 ohne Token
 *  - GET  /bookings/me:       Eigene Buchungen, Pagination via before=<id>
 *  - POST /bookings/:id/void: Storno im Fenster, Storno nach Fenster (409),
 *                             fremde Buchung als Member (403), Admin-Storno ohne Zeitlimit,
 *                             doppeltes Storno (409)
 *  - GET  /bookings (Admin):  Alle Buchungen, Filter nach member_id, include_voided
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
  aliceToken: string;
  bobToken: string;
  allgemeinToken: string;
  aliceId: number;
  allgemeinId: number;
  drinkId: number;
}

async function setupApp(): Promise<TestContext> {
  const db = createTestDb();
  const membersRepo = new MembersRepo(db);
  const drinksRepo = new DrinksRepo(db);
  const passwordHash = await bcrypt.hash('geheim123', 10);

  membersRepo.create({
    username: 'admin',
    display_name: 'Administrator',
    password_hash: passwordHash,
    role: 'admin',
  });
  const alice = membersRepo.create({
    username: 'alice',
    display_name: 'Alice Muster',
    password_hash: passwordHash,
    role: 'member',
  });
  membersRepo.create({
    username: 'bob',
    display_name: 'Bob Beispiel',
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

  const app = createApp({ logger: silentLogger, db, env: testEnv });

  const [adminToken, aliceToken, bobToken, allgemeinToken] = await Promise.all([
    getToken(app, 'admin'),
    getToken(app, 'alice'),
    getToken(app, 'bob'),
    getToken(app, 'allgemein'),
  ]);

  return {
    app,
    db,
    adminToken,
    aliceToken,
    bobToken,
    allgemeinToken,
    aliceId: alice.id,
    allgemeinId: allgemein.id,
    drinkId: drink.id,
  };
}

async function getToken(app: Express, username: string, password = 'geheim123'): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ username, password });
  return res.body.token as string;
}

// ---------------------------------------------------------------------------
// POST /bookings
// ---------------------------------------------------------------------------

describe('POST /api/v1/bookings', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('legt eine Buchung an (happy path)', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ drink_id: ctx.drinkId });

    expect(res.status).toBe(201);
    expect(res.body.drink_id).toBe(ctx.drinkId);
    expect(res.body.price_cents_snapshot).toBe(150);
    expect(res.body.voided_at).toBeNull();
  });

  it('speichert den Preis-Snapshot – Preisänderung danach beeinflusst Buchung nicht', async () => {
    // Erst buchen
    const bookingRes = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ drink_id: ctx.drinkId });

    expect(bookingRes.status).toBe(201);
    expect(bookingRes.body.price_cents_snapshot).toBe(150);

    // Preis erhöhen
    await request(ctx.app)
      .post(`/api/v1/drinks/${ctx.drinkId}/prices`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ price_cents: 200 });

    // Alte Buchung hat noch den alten Preis
    const meRes = await request(ctx.app)
      .get('/api/v1/bookings/me')
      .set('Authorization', `Bearer ${ctx.aliceToken}`);

    expect(meRes.body.items[0].price_cents_snapshot).toBe(150);
  });

  it('gibt 404 für unbekanntes Getränk zurück', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ drink_id: 9999 });

    expect(res.status).toBe(404);
  });

  it('gibt 409 für deaktiviertes Getränk zurück', async () => {
    // Getränk deaktivieren
    await request(ctx.app)
      .patch(`/api/v1/drinks/${ctx.drinkId}`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ is_available: 0 });

    const res = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ drink_id: ctx.drinkId });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('DRINK_UNAVAILABLE');
  });

  it('gibt 401 ohne Token zurück', async () => {
    const res = await request(ctx.app).post('/api/v1/bookings').send({ drink_id: ctx.drinkId });

    expect(res.status).toBe(401);
  });

  it('gibt 400 bei fehlendem drink_id zurück', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({});

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /bookings/me
// ---------------------------------------------------------------------------

describe('GET /api/v1/bookings/me', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('gibt eigene Buchungen zurück', async () => {
    // Zwei Buchungen für Alice
    await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ drink_id: ctx.drinkId });
    await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ drink_id: ctx.drinkId });

    const res = await request(ctx.app)
      .get('/api/v1/bookings/me')
      .set('Authorization', `Bearer ${ctx.aliceToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.hasMore).toBe(false);
  });

  it('gibt nur eigene Buchungen zurück (nicht von Bob)', async () => {
    await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.bobToken}`)
      .send({ drink_id: ctx.drinkId });

    const res = await request(ctx.app)
      .get('/api/v1/bookings/me')
      .set('Authorization', `Bearer ${ctx.aliceToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  it('paginiert korrekt via before=<id>', async () => {
    const bookingsRepo = new BookingsRepo(ctx.db);
    const drink = new DrinksRepo(ctx.db).findById(ctx.drinkId)!;
    const price = new DrinksRepo(ctx.db).getCurrentPrice(ctx.drinkId)!;

    // 3 Buchungen direkt über Repo (schnell)
    const b1 = bookingsRepo.create({
      member_id: 2,
      drink_id: drink.id,
      price_cents_snapshot: price.price_cents,
    });
    const b2 = bookingsRepo.create({
      member_id: 2,
      drink_id: drink.id,
      price_cents_snapshot: price.price_cents,
    });
    const b3 = bookingsRepo.create({
      member_id: 2,
      drink_id: drink.id,
      price_cents_snapshot: price.price_cents,
    });

    // Erste Seite: limit=2, neueste zuerst → b3, b2
    const page1 = await request(ctx.app)
      .get('/api/v1/bookings/me?limit=2')
      .set('Authorization', `Bearer ${ctx.aliceToken}`);

    expect(page1.body.items).toHaveLength(2);
    expect(page1.body.hasMore).toBe(true);
    expect(page1.body.items[0].id).toBe(b3.id);
    expect(page1.body.items[1].id).toBe(b2.id);

    // Zweite Seite: before=b2.id → b1
    const page2 = await request(ctx.app)
      .get(`/api/v1/bookings/me?limit=2&before=${b2.id}`)
      .set('Authorization', `Bearer ${ctx.aliceToken}`);

    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.hasMore).toBe(false);
    expect(page2.body.items[0].id).toBe(b1.id);
  });
});

// ---------------------------------------------------------------------------
// POST /bookings/:id/void
// ---------------------------------------------------------------------------

describe('POST /api/v1/bookings/:id/void', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('storniert eine eigene Buchung innerhalb von 5 Minuten', async () => {
    const bookingRes = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ drink_id: ctx.drinkId });

    const bookingId = bookingRes.body.id as number;

    const voidRes = await request(ctx.app)
      .post(`/api/v1/bookings/${bookingId}/void`)
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ reason: 'Versehen' });

    expect(voidRes.status).toBe(200);
    expect(voidRes.body.voided_at).not.toBeNull();
    expect(voidRes.body.void_reason).toBe('Versehen');
  });

  it('gibt 409 wenn das 5-Minuten-Fenster abgelaufen ist', async () => {
    // Buchung direkt über Repo mit altem Timestamp anlegen
    const bookingsRepo = new BookingsRepo(ctx.db);
    const price = new DrinksRepo(ctx.db).getCurrentPrice(ctx.drinkId)!;
    const oldBooking = bookingsRepo.create({
      member_id: 2, // alice = id 2
      drink_id: ctx.drinkId,
      price_cents_snapshot: price.price_cents,
    });

    // booked_at 10 Minuten in die Vergangenheit setzen
    ctx.db
      .prepare(`UPDATE bookings SET booked_at = datetime('now', '-10 minutes') WHERE id = ?`)
      .run(oldBooking.id);

    const res = await request(ctx.app)
      .post(`/api/v1/bookings/${oldBooking.id}/void`)
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VOID_WINDOW_EXPIRED');
  });

  it('gibt 403 wenn Member eine fremde Buchung stornieren will', async () => {
    // Bob bucht
    const bobBooking = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.bobToken}`)
      .send({ drink_id: ctx.drinkId });

    // Alice versucht Bobs Buchung zu stornieren
    const res = await request(ctx.app)
      .post(`/api/v1/bookings/${bobBooking.body.id}/void`)
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({});

    expect(res.status).toBe(403);
  });

  it('Admin kann jede Buchung ohne Zeitlimit stornieren', async () => {
    const bookingsRepo = new BookingsRepo(ctx.db);
    const price = new DrinksRepo(ctx.db).getCurrentPrice(ctx.drinkId)!;
    const oldBooking = bookingsRepo.create({
      member_id: 2,
      drink_id: ctx.drinkId,
      price_cents_snapshot: price.price_cents,
    });

    // 60 Minuten alt
    ctx.db
      .prepare(`UPDATE bookings SET booked_at = datetime('now', '-60 minutes') WHERE id = ?`)
      .run(oldBooking.id);

    const res = await request(ctx.app)
      .post(`/api/v1/bookings/${oldBooking.id}/void`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ reason: 'Admin-Korrektur' });

    expect(res.status).toBe(200);
    expect(res.body.voided_at).not.toBeNull();
  });

  it('gibt 409 bei doppeltem Storno zurück', async () => {
    const bookingRes = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ drink_id: ctx.drinkId });

    const id = bookingRes.body.id as number;

    await request(ctx.app)
      .post(`/api/v1/bookings/${id}/void`)
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({});

    const res = await request(ctx.app)
      .post(`/api/v1/bookings/${id}/void`)
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ALREADY_VOIDED');
  });

  it('gibt 404 für unbekannte Buchungs-ID zurück', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/bookings/9999/void')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({});

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /bookings  (Admin)
// ---------------------------------------------------------------------------

describe('GET /api/v1/bookings (Admin)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('gibt 403 zurück für normale Mitglieder', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.aliceToken}`);

    expect(res.status).toBe(403);
  });

  it('gibt alle aktiven Buchungen zurück', async () => {
    // Alice und Bob buchen je einmal
    await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ drink_id: ctx.drinkId });
    await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.bobToken}`)
      .send({ drink_id: ctx.drinkId });

    const res = await request(ctx.app)
      .get('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('filtert nach member_id', async () => {
    await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ drink_id: ctx.drinkId });
    await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.bobToken}`)
      .send({ drink_id: ctx.drinkId });

    // member_id=2 = alice
    const res = await request(ctx.app)
      .get('/api/v1/bookings?member_id=2')
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].member_id).toBe(2);
  });

  it('zeigt stornierte Buchungen mit include_voided=true', async () => {
    const bookingRes = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ drink_id: ctx.drinkId });

    await request(ctx.app)
      .post(`/api/v1/bookings/${bookingRes.body.id}/void`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({});

    // Ohne Flag: stornierte ausgeblendet
    const withoutFlag = await request(ctx.app)
      .get('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(withoutFlag.body).toHaveLength(0);

    // Mit Flag: stornierte sichtbar
    const withFlag = await request(ctx.app)
      .get('/api/v1/bookings?include_voided=true')
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(withFlag.body).toHaveLength(1);
    expect(withFlag.body[0].voided_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// M9: Buchen für andere (Theken-/Allgemein-Konto)
// ---------------------------------------------------------------------------

describe('POST /api/v1/bookings — für anderes Mitglied (M9)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('Allgemein-Konto bucht für ein anderes Mitglied (201, member_id = Ziel)', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.allgemeinToken}`)
      .send({ drink_id: ctx.drinkId, member_id: ctx.aliceId });

    expect(res.status).toBe(201);
    expect(res.body.member_id).toBe(ctx.aliceId);
    expect(res.body.booked_by_id).toBe(ctx.allgemeinId);
  });

  it('normales Mitglied darf NICHT für andere buchen (403)', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ drink_id: ctx.drinkId, member_id: ctx.allgemeinId });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it('Allgemein-Konto bucht für unbekanntes Mitglied (404)', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.allgemeinToken}`)
      .send({ drink_id: ctx.drinkId, member_id: 9999 });

    expect(res.status).toBe(404);
  });

  it('member_id = eigene ID verhält sich wie Selbstbuchung (booked_by_id null)', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ drink_id: ctx.drinkId, member_id: ctx.aliceId });

    expect(res.status).toBe(201);
    expect(res.body.booked_by_id).toBeNull();
  });
});

describe('GET /api/v1/bookings/member/:id (M9)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('Allgemein-Konto liest die Buchungen eines Mitglieds', async () => {
    await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.allgemeinToken}`)
      .send({ drink_id: ctx.drinkId, member_id: ctx.aliceId });

    const res = await request(ctx.app)
      .get(`/api/v1/bookings/member/${ctx.aliceId}`)
      .set('Authorization', `Bearer ${ctx.allgemeinToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].member_id).toBe(ctx.aliceId);
  });

  it('normales Mitglied darf keine fremden Buchungen lesen (403)', async () => {
    const res = await request(ctx.app)
      .get(`/api/v1/bookings/member/${ctx.aliceId}`)
      .set('Authorization', `Bearer ${ctx.bobToken}`);

    expect(res.status).toBe(403);
  });

  it('normales Mitglied darf die eigenen Buchungen über diesen Endpunkt lesen', async () => {
    await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ drink_id: ctx.drinkId });

    const res = await request(ctx.app)
      .get(`/api/v1/bookings/member/${ctx.aliceId}`)
      .set('Authorization', `Bearer ${ctx.aliceToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
  });
});

describe('POST /api/v1/bookings/:id/void — durch Allgemein-Konto (M9)', () => {
  let ctx: TestContext;

  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('Allgemein-Konto storniert eine selbst angelegte Fremdbuchung (im Fenster)', async () => {
    const booking = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.allgemeinToken}`)
      .send({ drink_id: ctx.drinkId, member_id: ctx.aliceId });

    const res = await request(ctx.app)
      .post(`/api/v1/bookings/${booking.body.id}/void`)
      .set('Authorization', `Bearer ${ctx.allgemeinToken}`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.voided_at).not.toBeNull();
  });

  it('Allgemein-Konto darf eine Selbstbuchung eines anderen Mitglieds NICHT stornieren (403)', async () => {
    const booking = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.aliceToken}`)
      .send({ drink_id: ctx.drinkId });

    const res = await request(ctx.app)
      .post(`/api/v1/bookings/${booking.body.id}/void`)
      .set('Authorization', `Bearer ${ctx.allgemeinToken}`)
      .send({});

    expect(res.status).toBe(403);
  });
});
