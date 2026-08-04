/**
 * Integrationstests für die Drink-Categories-Endpunkte und die
 * Verbrauchs-Auswertung.
 *
 * Getestete Szenarien:
 *  - GET  /drink-categories:        alle eingeloggten Nutzer, Sortierung
 *  - POST /drink-categories:        anlegen (Admin), 403 als Member, 409 Duplikat
 *  - PATCH /drink-categories/:id:   umbenennen, 404
 *  - PUT  /drink-categories/order:  Reihenfolge, 400 bei unvollständiger Menge
 *  - DELETE /drink-categories/:id:  204 wenn leer, 409 wenn belegt
 *  - GET /reports/consumption:      CSV/PDF, 400 bei fehlenden Parametern
 */

import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { createTestDb } from '../unit/db/helpers.js';
import { MembersRepo } from '../../src/db/repos/MembersRepo.js';
import { DrinkCategoriesRepo } from '../../src/db/repos/DrinkCategoriesRepo.js';
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

interface TestContext {
  app: Express;
  db: Db;
  adminToken: string;
  memberToken: string;
  sonstigeId: number;
}

async function setupApp(): Promise<TestContext> {
  const db = createTestDb();
  const membersRepo = new MembersRepo(db);
  const categoriesRepo = new DrinkCategoriesRepo(db);
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

  const sonstige = categoriesRepo.findByName('Sonstige')!;

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
    sonstigeId: sonstige.id,
  };
}

// ---------------------------------------------------------------------------
// GET /drink-categories
// ---------------------------------------------------------------------------

describe('GET /api/v1/drink-categories', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('liefert die Kategorien für eingeloggte Nutzer (200)', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/drink-categories')
      .set('Authorization', `Bearer ${ctx.memberToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('Sonstige');
  });

  it('gibt 401 ohne Token', async () => {
    const res = await request(ctx.app).get('/api/v1/drink-categories');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /drink-categories
// ---------------------------------------------------------------------------

describe('POST /api/v1/drink-categories', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('legt eine Kategorie an (201, Admin)', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/drink-categories')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ name: 'Bier' });

    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Bier');
    expect(res.body.sort_order).toBe(1); // nach „Sonstige" (0)
  });

  it('gibt 409 bei doppeltem Namen', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/drink-categories')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ name: 'sonstige' }); // COLLATE NOCASE
    expect(res.status).toBe(409);
  });

  it('gibt 403 als Member', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/drink-categories')
      .set('Authorization', `Bearer ${ctx.memberToken}`)
      .send({ name: 'Bier' });
    expect(res.status).toBe(403);
  });

  it('gibt 400 bei leerem Namen', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/drink-categories')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ name: '' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PATCH / PUT order / DELETE
// ---------------------------------------------------------------------------

describe('PATCH & Reorder & DELETE /api/v1/drink-categories', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('benennt eine Kategorie um (200)', async () => {
    const created = await request(ctx.app)
      .post('/api/v1/drink-categories')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ name: 'Alt' });

    const res = await request(ctx.app)
      .patch(`/api/v1/drink-categories/${created.body.id}`)
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ name: 'Neu' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Neu');
  });

  it('gibt 404 bei unbekannter ID', async () => {
    const res = await request(ctx.app)
      .patch('/api/v1/drink-categories/9999')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  it('setzt die Reihenfolge neu (200)', async () => {
    const bier = await request(ctx.app)
      .post('/api/v1/drink-categories')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ name: 'Bier' });

    const res = await request(ctx.app)
      .put('/api/v1/drink-categories/order')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ ordered_ids: [bier.body.id, ctx.sonstigeId] });

    expect(res.status).toBe(200);
    expect(res.body.map((c: { name: string }) => c.name)).toEqual(['Bier', 'Sonstige']);
  });

  it('gibt 400 wenn die Reihenfolge nicht alle Kategorien enthält', async () => {
    await request(ctx.app)
      .post('/api/v1/drink-categories')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ name: 'Bier' });

    const res = await request(ctx.app)
      .put('/api/v1/drink-categories/order')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ ordered_ids: [ctx.sonstigeId] });

    expect(res.status).toBe(400);
  });

  it('löscht eine leere Kategorie (204)', async () => {
    const created = await request(ctx.app)
      .post('/api/v1/drink-categories')
      .set('Authorization', `Bearer ${ctx.adminToken}`)
      .send({ name: 'Leer' });

    const res = await request(ctx.app)
      .delete(`/api/v1/drink-categories/${created.body.id}`)
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(res.status).toBe(204);
  });

  it('verweigert das Löschen einer belegten Kategorie (409)', async () => {
    const drinksRepo = new DrinksRepo(ctx.db);
    drinksRepo.create({ name: 'Wasser', categoryId: ctx.sonstigeId, initialPriceCents: 50 });

    const res = await request(ctx.app)
      .delete(`/api/v1/drink-categories/${ctx.sonstigeId}`)
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// GET /reports/consumption
// ---------------------------------------------------------------------------

describe('GET /api/v1/reports/consumption', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('liefert ein CSV (200, Admin)', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/reports/consumption?from=2026-05-01&to=2026-05-31&format=csv')
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
  });

  it('liefert ein PDF (200, Admin)', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/reports/consumption?from=2026-05-01&to=2026-05-31&format=pdf')
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
  });

  it('gibt 400 bei fehlenden Parametern', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/reports/consumption?format=csv')
      .set('Authorization', `Bearer ${ctx.adminToken}`);
    expect(res.status).toBe(400);
  });

  it('gibt 403 als Member', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/reports/consumption?from=2026-05-01&to=2026-05-31&format=csv')
      .set('Authorization', `Bearer ${ctx.memberToken}`);
    expect(res.status).toBe(403);
  });
});
