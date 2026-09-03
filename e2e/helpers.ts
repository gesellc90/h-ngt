/**
 * Wiederverwendbare Helper für die Specs.
 *
 * Bewusst auf Rollen-Selektoren (`getByRole`, `getByLabel`) statt CSS-Klassen
 * gesetzt — robuster gegen Tailwind-Refactorings und gleichzeitig ein
 * implizites a11y-Smoke-Check.
 */

import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const TEST_PASSWORDS = Object.freeze({
  admin: 'admin-passwort',
  anna: 'anna-passwort',
  bernd: 'bernd-passwort',
  allgemein: 'allgemein-passwort',
});

/**
 * Login über die UI. Wartet auf die Weiterleitung nach /buchen
 * (member) bzw. lässt den Caller die Admin-Routen selbst ansteuern.
 */
export async function loginViaUi(page: Page, username: string, password: string): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Benutzername').fill(username);
  await page.getByLabel('Passwort').fill(password);
  await page.getByRole('button', { name: /anmelden|einloggen|login/i }).click();
  // Auf die Weiterleitung weg von /login warten — sonst rennen nachfolgende
  // Navigationen dem noch laufenden Login-Roundtrip davon (Flakiness).
  await page.waitForURL((url) => !url.pathname.endsWith('/login'));
}

/**
 * Login über die API — nützlich für Test-Setup ohne UI-Roundtrip.
 * Setzt das Token in localStorage, damit der bestehende API-Client es findet.
 */
export async function loginViaApi(
  request: APIRequestContext,
  page: Page,
  username: string,
  password: string,
): Promise<string> {
  const apiBase = `http://127.0.0.1:${process.env['E2E_BACKEND_PORT'] ?? 3101}`;
  const res = await request.post(`${apiBase}/api/v1/auth/login`, {
    data: { username, password },
  });
  expect(res.ok(), `Login fehlgeschlagen für ${username}`).toBeTruthy();
  const body = (await res.json()) as { token: string };

  await page.addInitScript((token: string) => {
    window.localStorage.setItem('auth_token', token);
  }, body.token);

  return body.token;
}
