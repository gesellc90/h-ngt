/* eslint-disable no-console */
/**
 * Globaler Teardown — stoppt Backend + vite preview und räumt tmpDir auf.
 *
 * `console.log` ist hier gewollt (Status-Output für CI-Logs), gleiche
 * Konvention wie in `global-setup.ts`.
 *
 * Wird von Playwright nach allen Tests aufgerufen (auch nach Fehlern, solange
 * globalSetup erfolgreich war). Der zusätzliche `process.on('exit', …)`-Hook
 * in globalSetup deckt den Abbruch-Fall ab.
 */

import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { E2EHandle } from './global-setup.js';

// Gleicher Fallback wie in global-setup.ts (E2E_DB_DIR) — fester Pfad statt
// mkdtemp, siehe Kommentar dort.
const E2E_DB_DIR = process.env['E2E_DB_DIR'] ?? path.join(tmpdir(), 'getraenke-e2e-db');

function stopProcess(label: string, child: ChildProcess): Promise<void> {
  return new Promise<void>((resolve) => {
    if (child.killed || child.exitCode !== null) {
      resolve();
      return;
    }
    const timeout = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    child.kill('SIGTERM');
    console.log(`[e2e-teardown] SIGTERM → ${label}`);
  });
}

export default async function globalTeardown(): Promise<void> {
  const handle = (globalThis as { __E2E__?: E2EHandle }).__E2E__;
  if (!handle) return;

  await Promise.all([stopProcess('backend', handle.backend), stopProcess('vite', handle.frontend)]);

  try {
    rmSync(handle.tmpDir, { recursive: true, force: true });
    console.log(`[e2e-teardown] tmpDir entfernt: ${handle.tmpDir}`);
  } catch (err) {
    console.warn('[e2e-teardown] tmpDir-Cleanup fehlgeschlagen:', err);
  }

  try {
    rmSync(E2E_DB_DIR, { recursive: true, force: true });
    console.log(`[e2e-teardown] DB-Verzeichnis entfernt: ${E2E_DB_DIR}`);
  } catch (err) {
    console.warn('[e2e-teardown] DB-Verzeichnis-Cleanup fehlgeschlagen:', err);
  }

  try {
    rmSync(handle.updateStateDir, { recursive: true, force: true });
    console.log(`[e2e-teardown] updateStateDir entfernt: ${handle.updateStateDir}`);
  } catch (err) {
    console.warn('[e2e-teardown] updateStateDir-Cleanup fehlgeschlagen:', err);
  }
}
