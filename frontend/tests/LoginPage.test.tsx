import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../src/contexts/AuthContext';
import { ToastProvider } from '../src/contexts/ToastContext';
import LoginPage from '../src/pages/LoginPage';
import { ApiError } from '../src/api/client';
import type { PublicMember } from '../src/types/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockLogin = vi.fn();
const mockMe = vi.fn();

vi.mock('../src/api/auth', () => ({
  authApi: {
    me: () => mockMe(),
    login: (...args: unknown[]) => mockLogin(...args),
    logout: vi.fn(),
  },
}));

const memberMock: PublicMember = {
  id: 1,
  username: 'max',
  display_name: 'Max',
  role: 'member',
  is_active: 1,
  member_status: 'aktiv',
  can_book_for_others: 0,
  is_wirtschaftskommission: 0,
  struck_until: null,
  email: null,
  avatar_path: null,
  created_at: '2024-01-01T00:00:00.000Z',
  updated_at: '2024-01-01T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Hilfsrenderer
// ---------------------------------------------------------------------------

function renderLogin() {
  return render(
    <MemoryRouter initialEntries={['/login']}>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/buchen" element={<div>Buchungsseite</div>} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  // Kein Token → kein /me-Call nötig
  mockMe.mockRejectedValue(new Error('no token'));
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('LoginPage', () => {
  it('rendert Username- und Passwort-Felder', () => {
    renderLogin();

    expect(screen.getByLabelText(/Benutzername/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Passwort/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Einloggen/i })).toBeInTheDocument();
  });

  it('Submit-Button ist deaktiviert, solange kein Username eingegeben ist', () => {
    renderLogin();

    expect(screen.getByRole('button', { name: /Einloggen/i })).toBeDisabled();
  });

  it('leitet nach erfolgreichem Login auf /buchen weiter', async () => {
    mockLogin.mockResolvedValue({ token: 'abc', member: memberMock });

    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Benutzername/i), 'max');
    await user.type(screen.getByLabelText(/Passwort/i), 'geheim123');
    await user.click(screen.getByRole('button', { name: /Einloggen/i }));

    expect(await screen.findByText('Buchungsseite')).toBeInTheDocument();
    expect(mockLogin).toHaveBeenCalledWith('max', 'geheim123');
  });

  it('zeigt Fehlermeldung bei falschen Zugangsdaten (401)', async () => {
    mockLogin.mockRejectedValue(new ApiError(401, 'Ungültige Zugangsdaten'));

    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Benutzername/i), 'falsch');
    await user.type(screen.getByLabelText(/Passwort/i), 'falsch');
    await user.click(screen.getByRole('button', { name: /Einloggen/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      /Benutzername oder Passwort nicht korrekt/i,
    );
  });

  it('zeigt Fehlermeldung bei Rate-Limit (429)', async () => {
    mockLogin.mockRejectedValue(new ApiError(429, 'Too many requests'));

    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Benutzername/i), 'max');
    await user.type(screen.getByLabelText(/Passwort/i), 'geheim123');
    await user.click(screen.getByRole('button', { name: /Einloggen/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/15 Minuten/i);
  });

  it('bereinigt führende Leerzeichen aus dem Benutzernamen', async () => {
    mockLogin.mockResolvedValue({ token: 'abc', member: memberMock });

    renderLogin();
    const user = userEvent.setup();

    await user.type(screen.getByLabelText(/Benutzername/i), '  max  ');
    await user.type(screen.getByLabelText(/Passwort/i), 'geheim123');
    await user.click(screen.getByRole('button', { name: /Einloggen/i }));

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('max', 'geheim123');
    });
  });
});
