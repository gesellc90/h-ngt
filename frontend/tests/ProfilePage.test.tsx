import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/contexts/AuthContext';
import { ToastProvider } from '../src/contexts/ToastContext';
import ToastContainer from '../src/components/Toast';
import ProfilePage from '../src/pages/ProfilePage';
import { ApiError } from '../src/api/client';
import type { PublicMember } from '../src/types/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockMe = vi.fn();
const mockUpdateMe = vi.fn();
const mockResendVerification = vi.fn();
const mockUploadAvatar = vi.fn();
const mockDeleteAvatar = vi.fn();

vi.mock('../src/api/auth', () => ({
  authApi: {
    me: () => mockMe(),
    updateMe: (...args: unknown[]) => mockUpdateMe(...args),
    resendVerification: () => mockResendVerification(),
    uploadAvatar: (...args: unknown[]) => mockUploadAvatar(...args),
    deleteAvatar: () => mockDeleteAvatar(),
    logout: vi.fn(),
    login: vi.fn(),
  },
}));

vi.mock('../src/api/bookings', () => ({
  bookingsApi: {
    getMine: vi.fn().mockResolvedValue({ items: [], hasMore: false }),
  },
}));

vi.mock('../src/api/drinks', () => ({
  drinksApi: {
    getAvailable: vi.fn().mockResolvedValue([]),
  },
}));

// ---------------------------------------------------------------------------
// Test-Daten
// ---------------------------------------------------------------------------

function makeMember(overrides: Partial<PublicMember> = {}): PublicMember {
  return {
    id: 1,
    username: 'alice',
    display_name: 'Alice',
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

function renderProfile() {
  localStorage.setItem('token', 'test-token');
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>
          <ProfilePage />
          <ToastContainer />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProfilePage — E-Mail-Verifizierung (M16)', () => {
  it('zeigt "nicht bestätigt" plus Resend-Button, wenn eine Adresse hinterlegt aber unbestätigt ist', async () => {
    mockMe.mockResolvedValue(makeMember({ email: 'alice@example.org', email_verified_at: null }));
    renderProfile();

    expect(await screen.findByText('nicht bestätigt')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Bestätigungsmail erneut senden/i }),
    ).toBeInTheDocument();
  });

  it('zeigt "bestätigt" ohne Resend-Button, wenn die Adresse verifiziert ist', async () => {
    mockMe.mockResolvedValue(
      makeMember({ email: 'alice@example.org', email_verified_at: '2026-01-01T00:00:00.000Z' }),
    );
    renderProfile();

    expect(await screen.findByText('bestätigt')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Bestätigungsmail erneut senden/i }),
    ).not.toBeInTheDocument();
  });

  it('zeigt keinen Badge und keinen Resend-Button ohne hinterlegte Adresse', async () => {
    mockMe.mockResolvedValue(makeMember({ email: null, email_verified_at: null }));
    renderProfile();

    await screen.findByText('Alice'); // Seite ist geladen
    expect(screen.queryByText('bestätigt')).not.toBeInTheDocument();
    expect(screen.queryByText('nicht bestätigt')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /Bestätigungsmail erneut senden/i }),
    ).not.toBeInTheDocument();
  });

  it('sendet die Bestätigungsmail erneut und zeigt einen Erfolgs-Toast', async () => {
    mockMe.mockResolvedValue(makeMember({ email: 'alice@example.org', email_verified_at: null }));
    mockResendVerification.mockResolvedValue(undefined);
    renderProfile();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole('button', { name: /Bestätigungsmail erneut senden/i }),
    );

    expect(mockResendVerification).toHaveBeenCalled();
    expect(await screen.findByText(/erneut versendet/i)).toBeInTheDocument();
  });

  it('zeigt einen verständlichen Fehler-Toast, wenn der Mailversand deaktiviert ist', async () => {
    mockMe.mockResolvedValue(makeMember({ email: 'alice@example.org', email_verified_at: null }));
    mockResendVerification.mockRejectedValue(
      new ApiError(503, 'Mailversand ist nicht aktiviert', 'MAIL_DISABLED'),
    );
    renderProfile();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole('button', { name: /Bestätigungsmail erneut senden/i }),
    );

    expect(
      await screen.findByText('Mailversand ist nicht aktiviert (MAIL_ENABLED=false).'),
    ).toBeInTheDocument();
  });
});
