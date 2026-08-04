/**
 * Integrationstests für die Drinks-Endpunkte.
 *
 * Getestete Szenarien:
 *  - GET  /drinks:              401 ohne Token, User sieht nur verfügbare + Preis,
 *                               Admin sieht alle (inkl. deaktivierter)
 *  - POST /drinks:              Anlegen (happy path), 400 Validierung, 403 als Member
 *  - PATCH /drinks/:id:         Name ändern, deaktivieren, 404, leerer Body
 *  - POST /drinks/:id/prices:   Neuer Preis sofort, zukünftiger Preis, 404, 400
 *  - GET  /drinks/:id/prices:   Preishistorie, 404
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

async function setupApp(): Promise<{ app: Express; db: Db }> {
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

  membersRepo.create({
    username: 'alice',
    display_name: 'Alice Muster',
    password_hash: passwordHash,
    role: 'member',
  });

  // Zwei Getränke anlegen: eines verfügbar, eines deaktiviert
  drinksRepo.create({ name: 'Cola', categoryId: 1, initialPriceCents: 150 });
  drinksRepo.create({ name: 'Wasser', categoryId: 1, initialPriceCents: 100 });
  drinksRepo.deactivate(2); // Wasser deaktivieren

  const app = createApp({ logger: silentLogger, db, env: testEnv });
  return { app, db };
}

async function getToken(app: Express, username: string, password = 'geheim123'): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ username, password });
  return res.body.token as string;
}

// ---------------------------------------------------------------------------
// GET /drinks
// ---------------------------------------------------------------------------

describe('GET /api/v1/drinks', () => {
  let app: Express;

  beforeEach(async () => {
    ({ app } = await setupApp());
  });

  it('gibt 401 ohne Token zurück', async () => {
    const res = await request(app).get('/api/v1/drinks');
    expect(res.status).toBe(401);
  });

  it('User sieht nur verfügbare Getränke mit aktuellem Preis', async () => {
    const token = await getToken(app, 'alice');
    const res = await request(app).get('/api/v1/drinks').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Cola');
    expect(res.body[0]).toHaveProperty('current_price_cents', 150);
  });

  it('Admin sieht alle Getränke (inkl. deaktivierter)', async () => {
    const token = await getToken(app, 'admin');
    const res = await request(app).get('/api/v1/drinks').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// POST /drinks
// ---------------------------------------------------------------------------

describe('POST /api/v1/drinks', () => {
  let app: Express;

  beforeEach(async () => {
    ({ app } = await setupApp());
  });

  it('legt ein neues Getränk an (happy path)', async () => {
    const token = await getToken(app, 'admin');
    const res = await request(app)
      .post('/api/v1/drinks')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bier', category_id: 1, price_cents: 200 });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Bier');
    expect(res.body.is_available).toBe(1);
    expect(res.body.category_id).toBe(1);
  });

  it('gibt 400 bei fehlender Kategorie zurück', async () => {
    const token = await getToken(app, 'admin');
    const res = await request(app)
      .post('/api/v1/drinks')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ohne Kategorie', price_cents: 200 });

    expect(res.status).toBe(400);
  });

  it('gibt 400 bei unbekannter Kategorie zurück', async () => {
    const token = await getToken(app, 'admin');
    const res = await request(app)
      .post('/api/v1/drinks')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Falsche Kategorie', category_id: 9999, price_cents: 200 });

    expect(res.status).toBe(400);
  });

  it('gibt 400 bei fehlendem price_cents zurück', async () => {
    const token = await getToken(app, 'admin');
    const res = await request(app)
      .post('/api/v1/drinks')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Saft' });

    expect(res.status).toBe(400);
  });

  it('gibt 400 bei negativem Preis zurück', async () => {
    const token = await getToken(app, 'admin');
    const res = await request(app)
      .post('/api/v1/drinks')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Saft', price_cents: -10 });

    expect(res.status).toBe(400);
  });

  it('gibt 403 zurück wenn kein Admin', async () => {
    const token = await getToken(app, 'alice');
    const res = await request(app)
      .post('/api/v1/drinks')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Bier', price_cents: 200 });

    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// PATCH /drinks/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/drinks/:id', () => {
  let app: Express;

  beforeEach(async () => {
    ({ app } = await setupApp());
  });

  it('ändert den Namen', async () => {
    const token = await getToken(app, 'admin');
    const res = await request(app)
      .patch('/api/v1/drinks/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Cola Zero' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Cola Zero');
  });

  it('deaktiviert ein Getränk', async () => {
    const token = await getToken(app, 'admin');
    const res = await request(app)
      .patch('/api/v1/drinks/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ is_available: 0 });

    expect(res.status).toBe(200);
    expect(res.body.is_available).toBe(0);

    // User sieht das deaktivierte Getränk nicht mehr
    const aliceToken = await getToken(app, 'alice');
    const listRes = await request(app)
      .get('/api/v1/drinks')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(listRes.body).toHaveLength(0);
  });

  it('gibt 404 für unbekannte ID zurück', async () => {
    const token = await getToken(app, 'admin');
    const res = await request(app)
      .patch('/api/v1/drinks/9999')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Ghost' });

    expect(res.status).toBe(404);
  });

  it('gibt 400 für leeren Body zurück', async () => {
    const token = await getToken(app, 'admin');
    const res = await request(app)
      .patch('/api/v1/drinks/1')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('gibt 400 für unbekannte Felder zurück (strict)', async () => {
    const token = await getToken(app, 'admin');
    const res = await request(app)
      .patch('/api/v1/drinks/1')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X', unknownField: true });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /drinks/:id/prices
// ---------------------------------------------------------------------------

describe('POST /api/v1/drinks/:id/prices', () => {
  let app: Express;

  beforeEach(async () => {
    ({ app } = await setupApp());
  });

  it('setzt einen neuen Preis ab sofort', async () => {
    const token = await getToken(app, 'admin');
    const res = await request(app)
      .post('/api/v1/drinks/1/prices')
      .set('Authorization', `Bearer ${token}`)
      .send({ price_cents: 175 });

    expect(res.status).toBe(201);
    expect(res.body.price_cents).toBe(175);
    expect(res.body.drink_id).toBe(1);
  });

  it('setzt einen Preis mit zukünftigem valid_from', async () => {
    const token = await getToken(app, 'admin');
    const futureDate = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const res = await request(app)
      .post('/api/v1/drinks/1/prices')
      .set('Authorization', `Bearer ${token}`)
      .send({ price_cents: 200, valid_from: futureDate });

    expect(res.status).toBe(201);
    expect(res.body.price_cents).toBe(200);
    // User sieht noch den alten Preis (zukünftiger gilt noch nicht)
    const aliceToken = await getToken(app, 'alice');
    const listRes = await request(app)
      .get('/api/v1/drinks')
      .set('Authorization', `Bearer ${aliceToken}`);
    expect(listRes.body[0].current_price_cents).toBe(150);
  });

  it('gibt 404 für unbekannte Getränke-ID zurück', async () => {
    const token = await getToken(app, 'admin');
    const res = await request(app)
      .post('/api/v1/drinks/9999/prices')
      .set('Authorization', `Bearer ${token}`)
      .send({ price_cents: 200 });

    expect(res.status).toBe(404);
  });

  it('gibt 400 bei ungültigem Datum zurück', async () => {
    const token = await getToken(app, 'admin');
    const res = await request(app)
      .post('/api/v1/drinks/1/prices')
      .set('Authorization', `Bearer ${token}`)
      .send({ price_cents: 200, valid_from: 'kein-datum' });

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /drinks/:id/prices
// ---------------------------------------------------------------------------

describe('GET /api/v1/drinks/:id/prices', () => {
  let app: Express;

  beforeEach(async () => {
    ({ app } = await setupApp());
  });

  it('gibt die Preishistorie zurück', async () => {
    const token = await getToken(app, 'admin');

    // Zweiten Preis hinzufügen
    await request(app)
      .post('/api/v1/drinks/1/prices')
      .set('Authorization', `Bearer ${token}`)
      .send({ price_cents: 175 });

    const res = await request(app)
      .get('/api/v1/drinks/1/prices')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    // Neuester zuerst
    expect(res.body[0].price_cents).toBe(175);
  });

  it('gibt 404 für unbekannte Getränke-ID zurück', async () => {
    const token = await getToken(app, 'admin');
    const res = await request(app)
      .get('/api/v1/drinks/9999/prices')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(404);
  });

  it('gibt 403 zurück wenn kein Admin', async () => {
    const aliceToken = await getToken(app, 'alice');
    const res = await request(app)
      .get('/api/v1/drinks/1/prices')
      .set('Authorization', `Bearer ${aliceToken}`);

    expect(res.status).toBe(403);
  });
});
