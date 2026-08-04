/**
 * Integrationstests für die Zeiger-Endpunkte.
 *
 * Getestete Szenarien:
 *  - POST /zeiger:         anlegen (veranstaltung, besuch mit Verbindung),
 *                          unbekannte Verbindung (404), inaktive Verbindung (409),
 *                          401 ohne Token
 *  - GET  /zeiger:         alle, filter ?status=offen, filter ?status=geschlossen
 *  - GET  /zeiger/:id:     happy path, 404 bei unbekannter ID
 *  - PATCH /zeiger/:id:    BBr/Gäste aktualisieren, auf geschlossenem Zeiger (409)
 *  - POST /zeiger/:id/close: schließen (happy path, mit finalen Zahlen),
 *                            doppeltes Schließen (409)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { createTestDb } from '../unit/db/helpers.js';
import { MembersRepo } from '../../src/db/repos/MembersRepo.js';
import { VerbindungenRepo } from '../../src/db/repos/VerbindungenRepo.js';
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
  adminToken: string;
  verbindungId: number;
}

async function setupApp(): Promise<TestContext> {
  const db = createTestDb();
  const membersRepo = new MembersRepo(db);
  const verbindungenRepo = new VerbindungenRepo(db);
  const passwordHash = await bcrypt.hash('geheim123', 10);

  membersRepo.create({
    username: 'admin',
    display_name: 'Admin',
    password_hash: passwordHash,
    role: 'admin',
  });
  membersRepo.create({
    username: 'alice',
    display_name: 'Alice',
    password_hash: passwordHash,
    role: 'member',
  });

  const verbindung = verbindungenRepo.create({
    name: 'Saxonia',
    zirkel: 'Sax.',
    ort: 'Musterstadt',
  });

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
    verbindungId: verbindung.id,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /api/v1/zeiger', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('legt einen Veranstaltungs-Zeiger an (201)', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/zeiger')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ titel: 'Kneipabend', art: 'veranstaltung' });

    expect(res.status).toBe(201);
    expect(res.body.titel).toBe('Kneipabend');
    expect(res.body.art).toBe('veranstaltung');
    expect(res.body.status).toBe('offen');
    expect(res.body.verbindung_id).toBeNull();
  });

  it('legt einen Besuchs-Zeiger mit Verbindung an (201)', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/zeiger')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({
        titel: 'Couleurbesuch',
        art: 'besuch',
        verbindung_id: ctx.verbindungId,
        anzahl_bundesbrueder: 8,
        anzahl_gaeste: 2,
      });

    expect(res.status).toBe(201);
    expect(res.body.verbindung_id).toBe(ctx.verbindungId);
    expect(res.body.anzahl_bundesbrueder).toBe(8);
  });

  it('liefert 404 bei unbekannter verbindung_id', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/zeiger')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ titel: 'Test', art: 'besuch', verbindung_id: 9999 });

    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOT_FOUND');
  });

  it('liefert 409 bei inaktiver Verbindung', async () => {
    const verbindungenRepo = new VerbindungenRepo(ctx.db);
    verbindungenRepo.deactivate(ctx.verbindungId);

    const res = await request(ctx.app)
      .post('/api/v1/zeiger')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ titel: 'Test', art: 'besuch', verbindung_id: ctx.verbindungId });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('VERBINDUNG_INACTIVE');
  });

  it('liefert 401 ohne Token', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/zeiger')
      .send({ titel: 'Test', art: 'veranstaltung' });

    expect(res.status).toBe(401);
  });

  it('liefert 400 bei leerem Titel', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/zeiger')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ titel: '', art: 'veranstaltung' });

    expect(res.status).toBe(400);
  });
});

describe('GET /api/v1/zeiger', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('liefert alle Zeiger (200)', async () => {
    await request(ctx.app)
      .post('/api/v1/zeiger')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ titel: 'Z1', art: 'veranstaltung' });
    await request(ctx.app)
      .post('/api/v1/zeiger')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ titel: 'Z2', art: 'besuch' });

    const res = await request(ctx.app)
      .get('/api/v1/zeiger')
      .set('Authorization', `Bearer ${ctx.memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it('filtert nach status=offen', async () => {
    const created = await request(ctx.app)
      .post('/api/v1/zeiger')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ titel: 'Offen', art: 'veranstaltung' });

    await request(ctx.app)
      .post(`/api/v1/zeiger/${created.body.id}/close`)
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({});

    await request(ctx.app)
      .post('/api/v1/zeiger')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ titel: 'Nochmals offen', art: 'veranstaltung' });

    const res = await request(ctx.app)
      .get('/api/v1/zeiger?status=offen')
      .set('Authorization', `Bearer ${ctx.memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].titel).toBe('Nochmals offen');
  });

  it('filtert nach status=geschlossen', async () => {
    const created = await request(ctx.app)
      .post('/api/v1/zeiger')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ titel: 'Wird geschlossen', art: 'veranstaltung' });

    await request(ctx.app)
      .post(`/api/v1/zeiger/${created.body.id}/close`)
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({});

    const res = await request(ctx.app)
      .get('/api/v1/zeiger?status=geschlossen')
      .set('Authorization', `Bearer ${ctx.memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe('geschlossen');
  });
});

describe('GET /api/v1/zeiger/:id', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('liefert einen einzelnen Zeiger (200)', async () => {
    const created = await request(ctx.app)
      .post('/api/v1/zeiger')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ titel: 'Einzelner', art: 'veranstaltung' });

    const res = await request(ctx.app)
      .get(`/api/v1/zeiger/${created.body.id}`)
      .set('Authorization', `Bearer ${ctx.memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body.titel).toBe('Einzelner');
  });

  it('liefert 404 bei unbekannter ID', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/zeiger/9999')
      .set('Authorization', `Bearer ${ctx.memberToken}`);

    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/v1/zeiger/:id', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('aktualisiert BBr/Gäste-Zahlen (200)', async () => {
    const created = await request(ctx.app)
      .post('/api/v1/zeiger')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ titel: 'Test', art: 'besuch', anzahl_bundesbrueder: 3 });

    const res = await request(ctx.app)
      .patch(`/api/v1/zeiger/${created.body.id}`)
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ anzahl_bundesbrueder: 10, anzahl_gaeste: 4 });

    expect(res.status).toBe(200);
    expect(res.body.anzahl_bundesbrueder).toBe(10);
    expect(res.body.anzahl_gaeste).toBe(4);
  });

  it('liefert 409 auf geschlossenem Zeiger', async () => {
    const created = await request(ctx.app)
      .post('/api/v1/zeiger')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ titel: 'Test', art: 'veranstaltung' });

    await request(ctx.app)
      .post(`/api/v1/zeiger/${created.body.id}/close`)
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({});

    const res = await request(ctx.app)
      .patch(`/api/v1/zeiger/${created.body.id}`)
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ anzahl_gaeste: 1 });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ZEIGER_CLOSED');
  });

  it('liefert 400 bei leerem Body', async () => {
    const created = await request(ctx.app)
      .post('/api/v1/zeiger')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ titel: 'Test', art: 'veranstaltung' });

    const res = await request(ctx.app)
      .patch(`/api/v1/zeiger/${created.body.id}`)
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/zeiger/:id/close', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('schließt einen Zeiger (200)', async () => {
    const created = await request(ctx.app)
      .post('/api/v1/zeiger')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ titel: 'Test', art: 'veranstaltung' });

    const res = await request(ctx.app)
      .post(`/api/v1/zeiger/${created.body.id}/close`)
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ anzahl_bundesbrueder: 12, anzahl_gaeste: 3 });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('geschlossen');
    expect(res.body.closed_at).toBeTruthy();
    expect(res.body.anzahl_bundesbrueder).toBe(12);
    expect(res.body.anzahl_gaeste).toBe(3);
  });

  it('liefert 409 beim doppelten Schließen', async () => {
    const created = await request(ctx.app)
      .post('/api/v1/zeiger')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ titel: 'Test', art: 'veranstaltung' });

    await request(ctx.app)
      .post(`/api/v1/zeiger/${created.body.id}/close`)
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({});

    const res = await request(ctx.app)
      .post(`/api/v1/zeiger/${created.body.id}/close`)
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('ZEIGER_ALREADY_CLOSED');
  });

  it('liefert 404 bei unbekannter ID', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/zeiger/9999/close')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({});

    expect(res.status).toBe(404);
  });
});
