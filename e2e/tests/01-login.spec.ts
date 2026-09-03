import { test, expect } from '@playwright/test';
import { loginViaUi, TEST_PASSWORDS } from '../helpers.js';

test.describe('Login-Flow', () => {
  test('Happy Path: anna kann sich einloggen und landet auf /buchen', async ({ page }) => {
    await loginViaUi(page, 'anna', TEST_PASSWORDS.anna);

    await expect(page).toHaveURL(/\/buchen$/);
    // Auf der Buchungsseite gibt es eine Überschrift mit Drinks.
    await expect(page.getByRole('heading', { name: /Strich setzen/i })).toBeVisible();
  });

  test('Falsches Passwort: Fehlermeldung sichtbar, kein Redirect', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Benutzername').fill('anna');
    await page.getByLabel('Passwort').fill('falsch-falsch-falsch');
    await page.getByRole('button', { name: /anmelden|einloggen|login/i }).click();

    // URL bleibt /login.
    await expect(page).toHaveURL(/\/login$/);
    // Irgendeine Fehlerausgabe wird sichtbar (role=alert oder Text mit „falsch"/„ungültig").
    const errorVisible = page
      .getByRole('alert')
      .or(page.getByText(/ungültig|falsch|fehlgeschlagen/i))
      .first();
    await expect(errorVisible).toBeVisible({ timeout: 5_000 });
  });
});
