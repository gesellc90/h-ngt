import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthProvider, useAuth } from '../../src/contexts/AuthContext';
import { setToken, getToken } from '../../src/api/client';
import type { PublicMember } from '../../src/types/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockMe = vi.fn();
const mockLogin = vi.fn();
const mockLogout = vi.fn();

vi.mock('../../src/api/auth', () => ({
  authApi: {
    me: () => mockMe(),
    login: (...args: unknown[]) => mockLogin(...args),
    logout: () => mockLogout(),
  },
}));

function makeMember(overrides: Partial<PublicMember> = {}): PublicMember {
  return {
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
    email_verified_at: null,
    avatar_path: null,
    created_at: '2024-01-01T00:00:00.000Z',
    updated_at: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Consumer, der den Kontext sichtbar macht
// ---------------------------------------------------------------------------

function Consumer() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="loading">{String(auth.isLoading)}</span>
      <span data-testid="authenticated">{String(auth.isAuthenticated)}</span>
      <span data-testid="admin">{String(auth.isAdmin)}</span>
      <span data-testid="canBook">{String(auth.canBookForOthers)}</span>
      <span data-testid="name">{auth.member?.display_name ?? '—'}</span>
      <button onClick={() => void auth.login('max', 'pw').catch(() => {})}>login</button>
      <button onClick={() => void auth.logout().catch(() => {})}>logout</button>
    </div>
  );
}

function renderAuth() {
  return render(
    <AuthProvider>
      <Consumer />
    </AuthProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Initialer Zustand
// ---------------------------------------------------------------------------

describe('AuthContext – Initialisierung', () => {
  it('ohne Token: nicht eingeloggt, kein /me-Call', async () => {
    renderAuth();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(mockMe).not.toHaveBeenCalled();
  });

  it('mit Token: lädt das Profil über /auth/me', async () => {
    setToken('gueltig');
    mockMe.mockResolvedValue(makeMember({ role: 'admin' }));

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('true'));
    expect(screen.getByTestId('admin')).toHaveTextContent('true');
    expect(screen.getByTestId('name')).toHaveTextContent('Max');
    expect(mockMe).toHaveBeenCalledOnce();
  });

  it('mit ungültigem Token: /me schlägt fehl → Token wird verworfen', async () => {
    setToken('kaputt');
    mockMe.mockRejectedValue(new Error('401'));

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByTestId('authenticated')).toHaveTextContent('false');
    expect(getToken()).toBeNull();
  });

  it('leitet canBookForOthers aus dem Flag ab', async () => {
    setToken('gueltig');
    mockMe.mockResolvedValue(makeMember({ can_book_for_others: 1 }));

    renderAuth();

    await waitFor(() => expect(screen.getByTestId('canBook')).toHaveTextContent('true'));
  });
});

// ---------------------------------------------------------------------------
// login / logout
// ---------------------------------------------------------------------------

describe('AuthContext – login/logout', () => {
  it('login speichert Token und Member', async () => {
    mockMe.mockRejectedValue(new Error('no token'));
    mockLogin.mockResolvedValue({ token: 'neues-token', member: makeMember() });

    renderAuth();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    await userEvent.click(screen.getByRole('button', { name: 'login' }));

    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('true'));
    expect(getToken()).toBe('neues-token');
    expect(mockLogin).toHaveBeenCalledWith('max', 'pw');
  });

  it('logout ruft die API und verwirft Token + Member', async () => {
    setToken('gueltig');
    mockMe.mockResolvedValue(makeMember());
    mockLogout.mockResolvedValue(undefined);

    renderAuth();
    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('true'));

    await userEvent.click(screen.getByRole('button', { name: 'logout' }));

    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('false'));
    expect(mockLogout).toHaveBeenCalledOnce();
    expect(getToken()).toBeNull();
  });

  it('logout verwirft die Session auch, wenn der API-Call fehlschlägt', async () => {
    setToken('gueltig');
    mockMe.mockResolvedValue(makeMember());
    mockLogout.mockRejectedValue(new Error('Netzwerk'));

    renderAuth();
    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('true'));

    await userEvent.click(screen.getByRole('button', { name: 'logout' }));

    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('false'));
    expect(getToken()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Globales 401-Event
// ---------------------------------------------------------------------------

describe('AuthContext – auth:unauthorized-Event', () => {
  it('setzt den Member zurück, wenn ein 401-Event gefeuert wird', async () => {
    setToken('gueltig');
    mockMe.mockResolvedValue(makeMember());

    renderAuth();
    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('true'));

    window.dispatchEvent(new Event('auth:unauthorized'));

    await waitFor(() => expect(screen.getByTestId('authenticated')).toHaveTextContent('false'));
  });
});
