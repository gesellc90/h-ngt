import { test, expect } from '@playwright/test';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loginViaUi, TEST_PASSWORDS } from '../helpers.js';

/**
 * E2E für die E-Mail-Verifizierung (M16).
 *
 * Die produktive Mail (mit dem echten Bestätigungslink) verlässt in der
 * E2E-Umgebung nicht das Backend — MAIL_ENABLED ist hier bewusst nicht
 * gesetzt (Default false), analog zu den übrigen Suiten, es steht kein
 * SMTP-Server zur Verfügung. Zudem speichert die App den Token laut Design
 * ausschließlich als SHA-256-Hash (nie im Klartext), sodass ein bereits
 * ausgestellter Token nicht aus der DB ausgelesen werden kann.
 *
 * Um trotzdem den vollen Bestätigungs-Flow (Link → POST /auth/verify-email →
 * Status-Wechsel) zu prüfen, legt dieser Test — genau wie
 * backend/tests/integration/emailVerification.test.ts — einen Token direkt
 * in der Test-DB an: gleiches Verfahren (32 Zufallsbytes, SHA-256-Hash), nur
 * eben von außen statt über den (hier deaktivierten) Mailversand.
 */

// Gleicher Fallback wie in global-setup.ts/global-teardown.ts (E2E_DB_DIR) —
// beide Prozesse berechnen ihn unabhängig, kein IPC zwischen Setup und Specs.
const E2E_DB_DIR = process.env['E2E_DB_DIR'] ?? path.join(os.tmpdir(), 'getraenke-e2e-db');
const DB_PATH = path.join(E2E_DB_DIR, 'getraenke.db');

/** Legt einen gültigen Verifizierungs-Token für ein Mitglied an und gibt den Klartext zurück. */
function seedVerificationToken(username: string, email: string): string {
  const db = new Database(DB_PATH);
  try {
    const member = db.prepare('SELECT id FROM members WHERE username = ?').get(username) as
      | { id: number }
      | undefined;
    if (!member) {
      throw new Error(`[10-email-verification] Mitglied '${username}' nicht gefunden.`);
    }

    const tokenPlain = crypto.randomBytes(32).toString('base64url');
    const tokenHash = crypto.createHash('sha256').update(tokenPlain).digest('hex');
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    db.prepare(
      `INSERT INTO email_verifications (member_id, email, token_hash, expires_at)
       VALUES (?, ?, ?, ?)`,
    ).run(member.id, email, tokenHash, expiresAt);

    return tokenPlain;
  } finally {
    db.close();
  }
}

test.describe('E-Mail-Verifizierung', () => {
  test('Adresse setzen zeigt "nicht bestätigt", Bestätigungslink schaltet auf "bestätigt"', async ({
    page,
  }) => {
    await loginViaUi(page, 'anna', TEST_PASSWORDS.anna);
    await page.goto('/profil');

    // Adresse setzen — löst intern automatisch eine Verifizierungsmail aus
    // (hier ohne Wirkung, da MAIL_ENABLED nicht gesetzt ist).
    await page.getByLabel('E-Mail-Adresse').fill('anna@e2e.test');
    await page.getByRole('button', { name: 'Speichern' }).click();
    await expect(page.getByText('Profil gespeichert.')).toBeVisible({ timeout: 5_000 });

    // Direkt nach dem Setzen: unbestätigt.
    await expect(page.getByText('nicht bestätigt')).toBeVisible();

    // Token für dieselbe Adresse direkt in der Test-DB anlegen (siehe Kommentar oben).
    const token = seedVerificationToken('anna', 'anna@e2e.test');

    await page.goto(`/verify-email?token=${token}`);
    await expect(page.getByText('erfolgreich bestätigt')).toBeVisible({ timeout: 5_000 });

    // Zurück im Profil: Status ist jetzt bestätigt.
    await page.goto('/profil');
    await expect(page.getByText('bestätigt', { exact: true })).toBeVisible();
    await expect(page.getByText('nicht bestätigt')).not.toBeVisible();
  });
});
