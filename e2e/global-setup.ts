/* eslint-disable no-console */
/**
 * Global-Setup für die Playwright-E2E-Suite.
 *
 * Setup-/Teardown-Skripte sind CLI-Helpers — `console.log` ist hier der
 * gewünschte Status-Output (gleiche Konvention wie `backend/src/db/seed.ts`).
 *
 * Reihenfolge:
 *  1. Temporäres Verzeichnis anlegen, DB-Pfad ableiten.
 *  2. JWT-Secret für die Test-Session generieren.
 *  3. Backend-Build muss vorliegen → wir starten `node backend/dist/server.js`
 *     mit den Test-Env-Vars (Migrationen laufen beim Boot automatisch).
 *  4. Auf /api/v1/health warten.
 *  5. Backend-Seed (gebautes seed.js) ausführen.
 *  6. Test-Seed direkt via better-sqlite3 (bcrypt-Hashes + alte Buchung).
 *  7. `vite preview` für das Frontend starten (Port 4173, mit /api-Proxy).
 *  8. Auf den Vite-Preview-Server warten.
 *  9. Prozess-Handles und Pfade in `global.__E2E__` ablegen,
 *     `globalTeardown` macht den Cleanup.
 *
 * Voraussetzung: `npm run build --workspace=backend && npm run build --workspace=frontend`
 * wurde im CI bzw. lokal vor `npm run test:e2e` ausgeführt.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const BACKEND_DIR = path.join(REPO_ROOT, 'backend');
const FRONTEND_DIR = path.join(REPO_ROOT, 'frontend');

const BACKEND_PORT = Number(process.env['E2E_BACKEND_PORT'] ?? 3101);
const FRONTEND_PORT = Number(process.env['E2E_FRONTEND_PORT'] ?? 4173);
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
// Fester Pfad (kein mkdtemp-Zufallssuffix wie bei tmpDir): Spec-Dateien laufen
// in eigenen Worker-Prozessen und können `globalThis.__E2E__` aus diesem
// Setup-Prozess nicht lesen — sie berechnen denselben Pfad unabhängig über
// denselben Fallback (analog zu E2E_BACKEND_PORT/E2E_FRONTEND_PORT), um vor
// dem Update-Test eine `update-status.json` vorzulegen.
const UPDATE_STATE_DIR =
  process.env['E2E_UPDATE_STATE_DIR'] ?? path.join(tmpdir(), 'getraenke-e2e-update-state');

export interface E2EHandle {
  tmpDir: string;
  dbPath: string;
  jwtSecret: string;
  updateStateDir: string;
  backend: ChildProcess;
  frontend: ChildProcess;
  backendUrl: string;
  frontendUrl: string;
}

async function waitForHttp(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return; // 404 ok für vite-preview-Wurzel
    } catch {
      // noch nicht bereit
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Timeout: ${url} antwortet nicht binnen ${timeoutMs} ms.`);
}

function spawnWithEnv(
  cmd: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  label: string,
): ChildProcess {
  const child = spawn(cmd, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout?.on('data', (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr?.on('data', (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  child.on('exit', (code) => {
    if (code !== null && code !== 0) {
      console.error(`[${label}] Prozess beendet mit Code ${code}`);
    }
  });
  return child;
}

export default async function globalSetup(): Promise<void> {
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'getraenke-e2e-'));
  const dbPath = path.join(tmpDir, 'getraenke.db');
  const jwtSecret = randomBytes(32).toString('hex'); // 64 Zeichen

  // Für den Auto-Update-Rückkanal (M14): Verzeichnis muss existieren, bevor
  // Specs eine update-status.json hineinschreiben können.
  mkdirSync(UPDATE_STATE_DIR, { recursive: true });

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(BACKEND_PORT),
    DB_PATH: dbPath,
    JWT_SECRET: jwtSecret,
    JWT_EXPIRES_IN: '8h',
    LOG_LEVEL: 'warn',
    UPDATE_STATE_DIR,
    // Rate-Limiter deaktivieren: alle E2E-Requests kommen von 127.0.0.1
    // und würden nach 5 Logins den gemeinsamen Bucket erschöpfen.
    DISABLE_RATE_LIMIT: 'true',
  };

  // --- Backend starten (Migrationen laufen beim Boot automatisch) -----------
  console.log(`[e2e-setup] Backend startet auf ${BACKEND_URL}, DB=${dbPath}`);
  const backend = spawnWithEnv(
    process.execPath,
    [path.join(BACKEND_DIR, 'dist', 'server.js')],
    BACKEND_DIR,
    childEnv,
    'backend',
  );
  await waitForHttp(`${BACKEND_URL}/api/v1/health`);
  console.log('[e2e-setup] Backend bereit.');

  // --- Standard-Seed (Members ohne Passwort, Drinks, Preise) ----------------
  const seedResult = spawnSync(
    process.execPath,
    [path.join(BACKEND_DIR, 'dist', 'db', 'seed.js')],
    { cwd: BACKEND_DIR, env: childEnv, stdio: 'inherit' },
  );
  if (seedResult.status !== 0) {
    throw new Error(`Backend-Seed fehlgeschlagen mit Exit-Code ${seedResult.status}`);
  }

  // --- Test-Seed (bcrypt-Passwörter + alte Buchung) -------------------------
  // Pure .mjs — kein tsx-Transpile nötig.
  const testSeedResult = spawnSync(
    process.execPath,
    [path.join(__dirname, 'seed', 'test-seed.mjs'), dbPath],
    { cwd: __dirname, env: childEnv, stdio: 'inherit' },
  );
  if (testSeedResult.status !== 0) {
    throw new Error(`Test-Seed fehlgeschlagen mit Exit-Code ${testSeedResult.status}`);
  }

  // --- Frontend (vite preview) ---------------------------------------------
  console.log(`[e2e-setup] vite preview startet auf ${FRONTEND_URL}`);
  const frontend = spawnWithEnv(
    'npx',
    ['vite', 'preview', '--port', String(FRONTEND_PORT), '--host', '127.0.0.1', '--strictPort'],
    FRONTEND_DIR,
    { ...childEnv, E2E_BACKEND_PORT: String(BACKEND_PORT) },
    'vite',
  );
  await waitForHttp(FRONTEND_URL);
  console.log('[e2e-setup] vite preview bereit.');

  const handle: E2EHandle = {
    tmpDir,
    dbPath,
    jwtSecret,
    updateStateDir: UPDATE_STATE_DIR,
    backend,
    frontend,
    backendUrl: BACKEND_URL,
    frontendUrl: FRONTEND_URL,
  };
  (globalThis as { __E2E__?: E2EHandle }).__E2E__ = handle;

  // Cleanup-Hook auch bei abruptem Beenden (Strg-C).
  process.on('exit', () => {
    try {
      if (!backend.killed) backend.kill('SIGTERM');
      if (!frontend.killed) frontend.kill('SIGTERM');
      rmSync(tmpDir, { recursive: true, force: true });
      rmSync(UPDATE_STATE_DIR, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  });
}
