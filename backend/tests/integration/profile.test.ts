/**
 * Integrationstests für die Selbst-Service-Endpunkte (M10 PR 2).
 *
 *  - PATCH /auth/me:        display_name, email, password ändern (eigenes Konto)
 *  - POST  /auth/me/avatar: Profilbild hochladen (WebP, 256×256)
 *  - DELETE /auth/me/avatar: Profilbild entfernen
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import bcrypt from 'bcryptjs';
import type { Express } from 'express';
import { createApp } from '../../src/app.js';
import { createTestDb } from '../unit/db/helpers.js';
import { MembersRepo } from '../../src/db/repos/MembersRepo.js';

const silentLogger = pino({ level: 'silent' });
const TEST_JWT_SECRET = 'test-secret-that-is-at-least-32-characters-long';

// Minimales 1×1 transparentes PNG (base64) — klein genug für Tests, valides Bild für sharp.
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

let avatarDir: string;

function makeTestEnv() {
  return {
    NODE_ENV: 'test' as const,
    PORT: 3001,
    LOG_LEVEL: 'silent' as const,
    DB_PATH: ':memory:',
    JWT_SECRET: TEST_JWT_SECRET,
    JWT_EXPIRES_IN: '8h',
    AVATAR_DIR: avatarDir,
    UPDATE_STATE_DIR: '/tmp',
    TRUST_PROXY: 0,
  };
}

async function setupApp(): Promise<{ app: Express }> {
  const db = createTestDb();
  const membersRepo = new MembersRepo(db);
  const passwordHash = await bcrypt.hash('geheim123', 10);

  membersRepo.create({
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

  const app = createApp({ logger: silentLogger, db, env: makeTestEnv() });
  return { app };
}

async function getToken(app: Express, username = 'alice', password = 'geheim123'): Promise<string> {
  const res = await request(app).post('/api/v1/auth/login').send({ username, password });
  return res.body.token as string;
}

beforeEach(() => {
  avatarDir = fs.mkdtempSync(path.join(os.tmpdir(), 'haengt-avatars-'));
});

afterEach(() => {
  fs.rmSync(avatarDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// PATCH /auth/me
// ---------------------------------------------------------------------------

describe('PATCH /api/v1/auth/me', () => {
  let app: Express;

  beforeEach(async () => {
    ({ app } = await setupApp());
  });

  it('ändert den Display-Namen', async () => {
    const token = await getToken(app);
    const res = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ display_name: 'Alice Neu' });

    expect(res.status).toBe(200);
    expect(res.body.display_name).toBe('Alice Neu');
    expect(res.body).not.toHaveProperty('password_hash');
  });

  it('setzt und normalisiert die E-Mail-Adresse', async () => {
    const token = await getToken(app);
    const res = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'Alice@Example.COM' });

    expect(res.status).toBe(200);
    expect(res.body.email).toBe('alice@example.com');
  });

  it('gibt 409 wenn E-Mail bereits von anderem Mitglied genutzt', async () => {
    // Bob bekommt zuerst die E-Mail
    const bobToken = await getToken(app, 'bob');
    await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${bobToken}`)
      .send({ email: 'belegt@example.com' });

    // Alice versucht dieselbe E-Mail
    const aliceToken = await getToken(app);
    const res = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${aliceToken}`)
      .send({ email: 'belegt@example.com' });

    expect(res.status).toBe(409);
    expect(res.body.code).toBe('EMAIL_TAKEN');
  });

  it('darf eigene E-Mail re-setzen ohne Konflikt', async () => {
    const token = await getToken(app);
    await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'alice@example.com' });

    const res = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'alice@example.com' });

    expect(res.status).toBe(200);
  });

  it('ändert das eigene Passwort mit korrektem aktuellen Passwort (Login danach möglich)', async () => {
    const token = await getToken(app);
    const res = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'neuesPasswort99', current_password: 'geheim123' });

    expect(res.status).toBe(200);

    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'neuesPasswort99' });

    expect(loginRes.status).toBe(200);
  });

  it('lehnt Passwortänderung ohne aktuelles Passwort ab (400)', async () => {
    const token = await getToken(app);
    const res = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'neuesPasswort99' });

    expect(res.status).toBe(400);
  });

  it('lehnt Passwortänderung mit falschem aktuellen Passwort ab (403)', async () => {
    const token = await getToken(app);
    const res = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ password: 'neuesPasswort99', current_password: 'falsch' });

    expect(res.status).toBe(403);
    expect(res.body.code).toBe('INVALID_CURRENT_PASSWORD');

    // Passwort darf NICHT geändert worden sein.
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ username: 'alice', password: 'geheim123' });
    expect(loginRes.status).toBe(200);
  });

  it('gibt 400 für leeren Body zurück', async () => {
    const token = await getToken(app);
    const res = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it('gibt 401 ohne Token zurück', async () => {
    const res = await request(app).patch('/api/v1/auth/me').send({ display_name: 'X' });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST /auth/me/avatar
// ---------------------------------------------------------------------------

describe('POST /api/v1/auth/me/avatar', () => {
  let app: Express;

  beforeEach(async () => {
    ({ app } = await setupApp());
  });

  it('lädt ein Profilbild hoch und speichert avatar_path', async () => {
    const token = await getToken(app);
    const res = await request(app)
      .post('/api/v1/auth/me/avatar')
      .set('Authorization', `Bearer ${token}`)
      .attach('avatar', TINY_PNG, { filename: 'test.png', contentType: 'image/png' });

    expect(res.status).toBe(200);
    expect(res.body.avatar_path).toMatch(/^\d+\.webp$/);

    // Datei muss im Avatar-Verzeichnis liegen
    const filePath = path.join(avatarDir, res.body.avatar_path as string);
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('gibt 400 ohne Datei zurück', async () => {
    const token = await getToken(app);
    const res = await request(app)
      .post('/api/v1/auth/me/avatar')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(400);
  });

  it('gibt 401 ohne Token zurück', async () => {
    const res = await request(app)
      .post('/api/v1/auth/me/avatar')
      .attach('avatar', TINY_PNG, { filename: 'test.png', contentType: 'image/png' });

    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// DELETE /auth/me/avatar
// ---------------------------------------------------------------------------

describe('DELETE /api/v1/auth/me/avatar', () => {
  let app: Express;

  beforeEach(async () => {
    ({ app } = await setupApp());
  });

  it('entfernt das Profilbild', async () => {
    const token = await getToken(app);

    // Erst hochladen
    const upload = await request(app)
      .post('/api/v1/auth/me/avatar')
      .set('Authorization', `Bearer ${token}`)
      .attach('avatar', TINY_PNG, { filename: 'test.png', contentType: 'image/png' });

    expect(upload.status).toBe(200);
    const filename = upload.body.avatar_path as string;

    // Dann löschen
    const del = await request(app)
      .delete('/api/v1/auth/me/avatar')
      .set('Authorization', `Bearer ${token}`);

    expect(del.status).toBe(200);
    expect(del.body.avatar_path).toBeNull();

    // Datei darf nicht mehr existieren
    expect(fs.existsSync(path.join(avatarDir, filename))).toBe(false);
  });

  it('funktioniert auch wenn kein Bild vorhanden (idempotent)', async () => {
    const token = await getToken(app);
    const res = await request(app)
      .delete('/api/v1/auth/me/avatar')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.avatar_path).toBeNull();
  });

  it('gibt 401 ohne Token zurück', async () => {
    const res = await request(app).delete('/api/v1/auth/me/avatar');
    expect(res.status).toBe(401);
  });
});
