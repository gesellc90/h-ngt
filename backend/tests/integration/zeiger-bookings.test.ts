/**
 * Integrationstests: Buchen auf einen Zeiger (M11 PR 3).
 *
 * Getestete Szenarien:
 *  - POST /bookings mit zeiger_id: Buchung landet auf dem Zeiger (201)
 *  - POST /bookings mit zeiger_id auf geschlossenem Zeiger (409 ZEIGER_CLOSED)
 *  - POST /bookings mit unbekannter zeiger_id (404)
 *  - GET  /bookings/me: Zeiger-Buchungen erscheinen NICHT
 *  - GET  /zeiger/:id/bookings: liefert nur Zeiger-Buchungen
 *  - GET  /zeiger/:id/bookings: 404 bei unbekanntem Zeiger
 *  - Storno einer Zeiger-Buchung funktioniert normal
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
};

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

interface TestContext {
  app: Express;
  db: Db;
  memberToken: string;
  drinkId: number;
  zeigerId: number;
}

async function setupApp(): Promise<TestContext> {
  const db = createTestDb();
  const membersRepo = new MembersRepo(db);
  const drinksRepo = new DrinksRepo(db);
  const passwordHash = await bcrypt.hash('geheim123', 10);

  membersRepo.create({
    username: 'alice',
    display_name: 'Alice',
    password_hash: passwordHash,
    role: 'member',
  });

  const drink = drinksRepo.create({ name: 'Bier', categoryId: 1, initialPriceCents: 150 });

  const app = createApp({ logger: silentLogger, db, env: testEnv });

  const memberLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ username: 'alice', password: 'geheim123' });
  const memberToken = memberLogin.body.token as string;

  const zeigerRes = await request(app)
    .post('/api/v1/zeiger')
    .set('Authorization', `Bearer ${memberToken}`)
    .send({ titel: 'Kneipabend', art: 'veranstaltung' });

  return { app, db, memberToken, drinkId: drink.id, zeigerId: zeigerRes.body.id as number };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /bookings mit zeiger_id', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('bucht auf einen offenen Zeiger (201)', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ drink_id: ctx.drinkId, zeiger_id: ctx.zeigerId });

    expect(res.status).toBe(201);
    expect(res.body.zeiger_id).toBe(ctx.zeigerId);
  });

  it('liefert 409 auf geschlossenem Zeiger', async () => {
    await request(ctx.app)
      .post(`/api/v1/zeiger/${ctx.zeigerId}/close`)
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({});

    const res = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ drink_id: ctx.drinkId, zeiger_id: ctx.zeigerId });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ZEIGER_CLOSED');
  });

  it('liefert 404 bei unbekannter zeiger_id', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ drink_id: ctx.drinkId, zeiger_id: 9999 });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });
});

describe('GET /bookings/me — Zeiger-Buchungen ausgeblendet', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('Zeiger-Buchung erscheint nicht in /bookings/me', async () => {
    // Persönliche Buchung
    await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ drink_id: ctx.drinkId });

    // Zeiger-Buchung
    await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ drink_id: ctx.drinkId, zeiger_id: ctx.zeigerId });

    const res = await request(ctx.app)
      .get('/api/v1/bookings/me')
      .set('Authorization', `Bearer ${ctx.memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].zeiger_id).toBeNull();
  });
});

describe('GET /zeiger/:id/bookings', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('liefert Buchungen des Zeigers (200)', async () => {
    await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ drink_id: ctx.drinkId, zeiger_id: ctx.zeigerId });

    await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ drink_id: ctx.drinkId, zeiger_id: ctx.zeigerId });

    // Persönliche Buchung soll nicht erscheinen
    await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ drink_id: ctx.drinkId });

    const res = await request(ctx.app)
      .get(`/api/v1/zeiger/${ctx.zeigerId}/bookings`)
      .set('Authorization', `Bearer ${ctx.memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body.every((b: { zeiger_id: number }) => b.zeiger_id === ctx.zeigerId)).toBe(true);
  });

  it('liefert leeres Array wenn keine Buchungen', async () => {
    const res = await request(ctx.app)
      .get(`/api/v1/zeiger/${ctx.zeigerId}/bookings`)
      .set('Authorization', `Bearer ${ctx.memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('liefert 404 bei unbekanntem Zeiger', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/zeiger/9999/bookings')
      .set('Authorization', `Bearer ${ctx.memberToken}`);

    expect(res.status).toBe(404);
  });

  it('Storno einer Zeiger-Buchung funktioniert normal', async () => {
    const bookingRes = await request(ctx.app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ drink_id: ctx.drinkId, zeiger_id: ctx.zeigerId });

    const voidRes = await request(ctx.app)
      .post(`/api/v1/bookings/${bookingRes.body.id}/void`)
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({});

    expect(voidRes.status).toBe(200);
    expect(voidRes.body.voided_at).toBeTruthy();

    // Stornierte Buchung taucht nicht mehr in /zeiger/:id/bookings auf
    const listRes = await request(ctx.app)
      .get(`/api/v1/zeiger/${ctx.zeigerId}/bookings`)
      .set('Authorization', `Bearer ${ctx.memberToken}`);

    expect(listRes.body).toHaveLength(0);
  });
});
