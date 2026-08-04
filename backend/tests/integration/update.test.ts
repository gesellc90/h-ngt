/**
 * Integrationstests für den Update-Router (M14).
 *
 * Getestete Szenarien:
 *  - GET  /update/status: 200 Admin, "unknown" ohne Statusdatei, 403 Member, 401 ohne Token
 *  - POST /update:        202 (Marker geschrieben), 403 Member, 409 bei bereits offenem Marker
 *  - POST /update/check:  202 mit mode "check"
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import bcrypt from 'bcryptjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { createTestDb } from '../unit/db/helpers.js';
import { MembersRepo } from '../../src/db/repos/MembersRepo.js';
import type { Db } from '../../src/db/client.js';

const silentLogger = pino({ level: 'silent' });
const TEST_JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';

interface TestContext {
  app: Express;
  db: Db;
  stateDir: string;
  adminToken: string;
  memberToken: string;
}

let stateDir: string;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-route-test-'));
});

afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

async function setupApp(): Promise<TestContext> {
  const db = createTestDb();
  const membersRepo = new MembersRepo(db);
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

  const app = createApp({
    logger: silentLogger,
    db,
    env: {
      NODE_ENV: 'test',
      PORT: 3001,
      LOG_LEVEL: 'silent',
      DB_PATH: ':memory:',
      JWT_SECRET: TEST_JWT_SECRET,
      JWT_EXPIRES_IN: '8h',
      AVATAR_DIR: '/tmp',
      UPDATE_STATE_DIR: stateDir,
      TRUST_PROXY: 0,
    },
  });

  const adminLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ username: 'admin', password: 'geheim123' });
  const memberLogin = await request(app)
    .post('/api/v1/auth/login')
    .send({ username: 'alice', password: 'geheim123' });

  return {
    app,
    db,
    stateDir,
    adminToken: adminLogin.body.token as string,
    memberToken: memberLogin.body.token as string,
  };
}

// ---------------------------------------------------------------------------
// GET /update/status
// ---------------------------------------------------------------------------

describe('GET /api/v1/update/status', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('gibt "unknown" zurück, wenn noch nie ein Update-Lauf stattfand (200, Admin)', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/update/status')
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.last_result).toBe('unknown');
  });

  it('liefert den vom Pi-Helper geschriebenen Status (200, Admin)', async () => {
    fs.writeFileSync(
      path.join(ctx.stateDir, 'update-status.json'),
      JSON.stringify({
        current_version: 'v1.0.0',
        available_version: 'v1.1.0',
        last_checked_at: '2026-07-01T03:30:00Z',
        last_result: 'update_available',
        last_trigger: 'timer',
        in_progress: false,
      }),
    );

    const res = await request(ctx.app)
      .get('/api/v1/update/status')
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.current_version).toBe('v1.0.0');
    expect(res.body.available_version).toBe('v1.1.0');
    expect(res.body.last_result).toBe('update_available');
  });

  it('gibt 403 als Member', async () => {
    const res = await request(ctx.app)
      .get('/api/v1/update/status')
      .set('Authorization', `Bearer ${ctx.memberToken}`);
    expect(res.status).toBe(403);
  });

  it('gibt 401 ohne Token', async () => {
    const res = await request(ctx.app).get('/api/v1/update/status');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /update  ("Jetzt aktualisieren")
// ---------------------------------------------------------------------------

describe('POST /api/v1/update', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('akzeptiert die Anfrage und schreibt den Marker (202, Admin)', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/update')
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true, mode: 'update' });
    expect(fs.readFileSync(path.join(ctx.stateDir, 'update-requested'), 'utf-8')).toBe('update');
  });

  it('gibt 409, wenn bereits eine Anfrage offen ist', async () => {
    await request(ctx.app).post('/api/v1/update').set('Authorization', `Bearer ${ctx.adminToken}`);

    const res = await request(ctx.app)
      .post('/api/v1/update')
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('UPDATE_IN_PROGRESS');
  });

  it('gibt 409, wenn der letzte bekannte Status "in_progress" ist', async () => {
    fs.writeFileSync(
      path.join(ctx.stateDir, 'update-status.json'),
      JSON.stringify({ last_result: 'in_progress', in_progress: true }),
    );

    const res = await request(ctx.app)
      .post('/api/v1/update')
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    expect(res.status).toBe(409);
  });

  it('gibt 403 als Member', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/update')
      .set('Authorization', `Bearer ${ctx.memberToken}`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /update/check  ("Jetzt prüfen")
// ---------------------------------------------------------------------------

describe('POST /api/v1/update/check', () => {
  let ctx: TestContext;
  beforeEach(async () => {
    ctx = await setupApp();
  });

  it('akzeptiert die Anfrage und schreibt den Marker mit mode "check" (202, Admin)', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/update/check')
      .set('Authorization', `Bearer ${ctx.adminToken}`);

    expect(res.status).toBe(202);
    expect(res.body).toEqual({ accepted: true, mode: 'check' });
    expect(fs.readFileSync(path.join(ctx.stateDir, 'update-requested'), 'utf-8')).toBe('check');
  });

  it('gibt 403 als Member', async () => {
    const res = await request(ctx.app)
      .post('/api/v1/update/check')
      .set('Authorization', `Bearer ${ctx.memberToken}`);
    expect(res.status).toBe(403);
  });
});
