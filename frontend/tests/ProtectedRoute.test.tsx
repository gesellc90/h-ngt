import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '../src/contexts/AuthContext';
import { ToastProvider } from '../src/contexts/ToastContext';
import ProtectedRoute from '../src/components/ProtectedRoute';
import type { PublicMember } from '../src/types/api';

// ---------------------------------------------------------------------------
// Hilfsfunktion: Wrapper mit Routing
// ---------------------------------------------------------------------------

function renderWithRouter(initialPath: string) {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<div>Login-Seite</div>} />
            <Route element={<ProtectedRoute />}>
              {/* / als Index-Route damit der Fallback-Redirect von ProtectedRoute role="admin" sichtbar wird */}
              <Route path="/" element={<div>Startseite</div>} />
              <Route path="/buchen" element={<div>Buchungsseite</div>} />
              <Route element={<ProtectedRoute role="admin" />}>
                <Route path="/admin" element={<div>Admin-Seite</div>} />
              </Route>
            </Route>
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockMe = vi.fn();

vi.mock('../src/api/auth', () => ({
  authApi: {
    me: () => mockMe(),
    login: vi.fn(),
    logout: vi.fn(),
  },
}));

const memberMock: PublicMember = {
  id: 1,
  username: 'test',
  display_name: 'Test User',
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
};

const adminMock: PublicMember = { ...memberMock, role: 'admin', id: 2 };

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProtectedRoute', () => {
  it('leitet auf /login weiter, wenn kein Token vorhanden ist', async () => {
    mockMe.mockRejectedValue(new Error('no token'));

    renderWithRouter('/buchen');

    expect(await screen.findByText('Login-Seite')).toBeInTheDocument();
  });

  it('zeigt die geschützte Seite für eingeloggte User', async () => {
    localStorage.setItem('token', 'valid-token');
    mockMe.mockResolvedValue(memberMock);

    renderWithRouter('/buchen');

    expect(await screen.findByText('Buchungsseite')).toBeInTheDocument();
  });

  it('leitet normalen User von Admin-Seite auf / weiter', async () => {
    localStorage.setItem('token', 'valid-token');
    mockMe.mockResolvedValue(memberMock); // role: 'member'

    renderWithRouter('/admin');

    // ProtectedRoute role="admin" leitet auf / weiter — Startseite ist sichtbar, Admin-Seite nicht
    expect(await screen.findByText('Startseite')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText('Admin-Seite')).not.toBeInTheDocument();
    });
  });

  it('zeigt Admin-Seite für Admins', async () => {
    localStorage.setItem('token', 'admin-token');
    mockMe.mockResolvedValue(adminMock); // role: 'admin'

    renderWithRouter('/admin');

    expect(await screen.findByText('Admin-Seite')).toBeInTheDocument();
  });
});
