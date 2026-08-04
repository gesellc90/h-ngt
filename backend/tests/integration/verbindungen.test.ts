/**
 * Integrationstests für die Verbindungen-Endpunkte (Admin-CRUD).
 *
 * Getestete Szenarien:
 *  - GET  /verbindungen:      alle aktiven, ?includeInactive=true
 *  - POST /verbindungen:      anlegen (Admin), 403 als Member, 400 bei leerem Namen
 *  - PATCH /verbindungen/:id: Name/Zirkel/Ort ändern, reaktivieren,
 *                             404 bei unbekannter ID, 403 als Member
 *  - DELETE /verbindungen/:id: deaktivieren (204), 404 bei unbekannter ID,
 *                              403 als Member
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
  adminToken: string;
  memberToken: string;
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
    adminToken: adminLogin.body.token as string,
    memberToken: memberLogin.body.token as string,
    verbindungId: verbindung.id,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /api/v1/verbindungen', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('liefert aktive Verbindungen (200)', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/verbindungen')
      .set('Authorization', `Bearer ${ctx.memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Saxonia');
  });

  it('schließt inaktive aus (Default)', async () => {
    await request(ctx.app)
      .delete(`/api/v1/verbindungen/${ctx.verbindungId}`)
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    const res = await request(ctx.app)
      .get('/api/v1/verbindungen')
      .set('Authorization', `Bearer ${ctx.memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it('liefert auch inaktive mit ?includeInactive=true', async () => {
    await request(ctx.app)
      .delete(`/api/v1/verbindungen/${ctx.verbindungId}`)
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    const res = await request(ctx.app)
      .get('/api/v1/verbindungen?includeInactive=true')
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].active).toBe(0);
  });

  it('liefert 401 ohne Token', async () => {
    const res = await request(ctx.app).get('/api/v1/verbindungen');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/v1/verbindungen', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('legt eine Verbindung an (201)', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/verbindungen')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ name: 'Germania', zirkel: 'Germ.', ort: 'Beispielburg' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Germania');
    expect(res.body.zirkel).toBe('Germ.');
    expect(res.body.active).toBe(1);
  });

  it('legt ohne optionale Felder an (201)', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/verbindungen')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ name: 'Minimal' });

    expect(res.status).toBe(201);
    expect(res.body.zirkel).toBeNull();
    expect(res.body.ort).toBeNull();
  });

  it('liefert 403 als Member', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/verbindungen')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ name: 'Test' });

    expect(res.status).toBe(403);
  });

  it('liefert 400 bei leerem Namen', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/verbindungen')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ name: '' });

    expect(res.status).toBe(400);
  });
});

describe('PATCH /api/v1/verbindungen/:id', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('ändert Name und Ort (200)', async () => {
    const res = await request(ctx.app)
      .patch(`/api/v1/verbindungen/${ctx.verbindungId}`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ name: 'Saxonia Neu', ort: 'Neustadt' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Saxonia Neu');
    expect(res.body.ort).toBe('Neustadt');
    expect(res.body.zirkel).toBe('Sax.'); // unverändert
  });

  it('reaktiviert eine deaktivierte Verbindung', async () => {
    await request(ctx.app)
      .delete(`/api/v1/verbindungen/${ctx.verbindungId}`)
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    const res = await request(ctx.app)
      .patch(`/api/v1/verbindungen/${ctx.verbindungId}`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ active: 1 });

    expect(res.status).toBe(200);
    expect(res.body.active).toBe(1);
  });

  it('liefert 404 bei unbekannter ID', async () => {
    const res = await request(ctx.app)
      .patch('/api/v1/verbindungen/9999')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ name: 'X' });

    expect(res.status).toBe(404);
  });

  it('liefert 403 als Member', async () => {
    const res = await request(ctx.app)
      .patch(`/api/v1/verbindungen/${ctx.verbindungId}`)
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ name: 'Hack' });

    expect(res.status).toBe(403);
  });
});

describe('DELETE /api/v1/verbindungen/:id', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('deaktiviert eine Verbindung (204)', async () => {
    const res = await request(ctx.app)
      .delete(`/api/v1/verbindungen/${ctx.verbindungId}`)
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    expect(res.status).toBe(204);

    const list = await request(ctx.app)
      .get('/api/v1/verbindungen')
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(list.body).toHaveLength(0);
  });

  it('liefert 404 bei unbekannter ID', async () => {
    const res = await request(ctx.app)
      .delete('/api/v1/verbindungen/9999')
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    expect(res.status).toBe(404);
  });

  it('liefert 403 als Member', async () => {
    const res = await request(ctx.app)
      .delete(`/api/v1/verbindungen/${ctx.verbindungId}`)
      .set('Authorization', `Bearer ${ctx.memberToken}`);

    expect(res.status).toBe(403);
  });
});
