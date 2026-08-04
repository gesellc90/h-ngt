/**
 * Integrationstests für die Auth-Endpunkte.
 *
 * Getestete Szenarien:
 *  - POST /auth/login: happy path, falsches Passwort, unbekannter User,
 *    inaktiver User, fehlende Felder
 *  - GET /auth/me: mit gültigem Token, ohne Token, mit ungültigem Token
 *  - POST /auth/logout: Token wird invalidiert → /me danach 401
 *  - Rate-Limit: 6. Versuch innerhalb des Fensters → 429
 *
 * Jeder Testblock bekommt eine frische In-Memory-DB mit Migrationen + Seed-Daten,
 * damit die Tests vollständig unabhängig und deterministisch sind.
 */

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
};

// ---------------------------------------------------------------------------
// Hilfsfunktion: App + DB mit Testdaten aufsetzen
// ---------------------------------------------------------------------------

async function setupApp(): Promise<{ app: Express; db: Db }> {
  const db = createTestDb();
  const membersRepo = new MembersRepo(db);

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

  // Inaktiver User
  const inactiveHash = await bcrypt.hash('geheim123', 10);
  const inactive = membersRepo.create({
    username: 'inactive',
    display_name: 'Deaktiviertes Konto',
    password_hash: inactiveHash,
    role: 'member',
  });
  membersRepo.update(inactive.id, { is_active: 0 });

  const app = createApp({ logger: silentLogger, db, env: testEnv });
  return { app, db };
}

// ---------------------------------------------------------------------------
// POST /auth/login
// ---------------------------------------------------------------------------

describe('POST /api/v1/auth/login', () => {
  let app: Express;

  beforeEach(async () => {
    ({ app } = await setupApp());
  });

  it('gibt bei korrekten Daten einen JWT und Member-Infos zurück', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: 'geheim123' });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.member).toMatchObject({
      username: 'admin',
      role: 'admin',
    });
    expect(res.body.member).not.toHaveProperty('password_hash');
  });

  it('gibt 401 bei falschem Passwort zurück', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'falsch' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('gibt 401 bei unbekanntem Username zurück', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'nixda', password: 'geheim123' });

    expect(res.status).toBe(401);
  });

  it('gibt 401 bei inaktivem Account zurück', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'inactive', password: 'geheim123' });

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('ACCOUNT_INACTIVE');
  });

  it('gibt 400 bei fehlendem Passwort zurück', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ username: 'alice' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('details');
  });

  it('gibt 400 bei leerem Body zurück', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({});

    expect(res.status).toBe(400);
  });

  it('gibt 429 nach mehr als 5 Fehlversuchen zurück', async () => {
    // 5 Versuche ausschöpfen
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/auth/login').send({ username: 'alice', password: 'falsch' });
    }

    // 6. Versuch muss geblockt werden
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'falsch' });

    expect(res.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// GET /auth/me
// ---------------------------------------------------------------------------

describe('GET /api/v1/auth/me', () => {
  let app: Express;

  beforeEach(async () => {
    ({ app } = await setupApp());
  });

  it('gibt die eigenen Daten zurück, wenn Token gültig', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'geheim123' });

    const token = loginRes.body.token as string;

    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ username: 'alice', role: 'member' });
    // M9: /me liefert das öffentliche Member-Objekt inkl. Kategorie & Theken-Flag
    expect(res.body).toHaveProperty('member_status');
    expect(res.body).toHaveProperty('can_book_for_others');
    expect(res.body).not.toHaveProperty('password_hash');
  });

  it('gibt 401 ohne Authorization-Header zurück', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('gibt 401 bei ungültigem Token zurück', async () => {
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer das.ist.kein.gueltiger.jwt');

    expect(res.status).toBe(401);
  });

  it('verweigert den Zugriff sofort, wenn das Konto nachträglich deaktiviert wird', async () => {
    const { app: freshApp, db } = await setupApp();

    const loginRes = await request(freshApp)
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'geheim123' });
    const token = loginRes.body.token as string;

    // Token funktioniert zunächst.
    const before = await request(freshApp)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(before.status).toBe(200);

    // Admin deaktiviert alice → das (noch nicht abgelaufene) Token muss ungültig werden.
    const membersRepo = new MembersRepo(db);
    const alice = membersRepo.findByUsername('alice')!;
    membersRepo.deactivate(alice.id);

    const after = await request(freshApp)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(after.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/logout + Blocklist
// ---------------------------------------------------------------------------

describe('POST /api/v1/auth/logout', () => {
  let app: Express;

  beforeEach(async () => {
    ({ app } = await setupApp());
  });

  it('gibt 204 zurück und invalidiert anschließend den Token', async () => {
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'geheim123' });

    const token = loginRes.body.token as string;

    // Logout
    const logoutRes = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`);

    expect(logoutRes.status).toBe(204);

    // Token ist jetzt auf der Blocklist → /me muss 401 zurückgeben
    const meRes = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);

    expect(meRes.status).toBe(401);
  });

  it('gibt 401 zurück, wenn kein Token mitgeschickt wird', async () => {
    const res = await request(app).post('/api/v1/auth/logout');
    expect(res.status).toBe(401);
  });
});
