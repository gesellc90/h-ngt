import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../src/contexts/ToastContext';
import ToastContainer from '../src/components/Toast';
import StreichenPage from '../src/pages/StreichenPage';
import type { MemberStatus, PublicMember } from '../src/types/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetStrikeable = vi.fn();
const mockStrike = vi.fn();
const mockUnstrike = vi.fn();

vi.mock('../src/api/members', () => ({
  membersApi: {
    getStrikeable: () => mockGetStrikeable(),
    strike: (...args: unknown[]) => mockStrike(...args),
    unstrike: (...args: unknown[]) => mockUnstrike(...args),
  },
}));

// ---------------------------------------------------------------------------
// Test-Daten
// ---------------------------------------------------------------------------

const makeMember = (
  id: number,
  display_name: string,
  member_status: MemberStatus,
  struck_until: string | null = null,
): PublicMember => ({
  id,
  username: `u${id}`,
  display_name,
  role: 'member',
  is_active: 1,
  member_status,
  can_book_for_others: 0,
  is_wirtschaftskommission: 0,
  struck_until,
  email: null,
  email_verified_at: null,
  avatar_path: null,
  created_at: '',
  updated_at: '',
});

const inTwoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <StreichenPage />
        <ToastContainer />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('StreichenPage', () => {
  it('zeigt Konten gruppiert und mit Streichen-Button', async () => {
    mockGetStrikeable.mockResolvedValue([
      makeMember(1, 'Alice Aktiv', 'aktiv'),
      makeMember(2, 'Bob Alter Herr', 'alter_herr'),
    ]);
    renderPage();

    expect(await screen.findByText('Alice Aktiv')).toBeInTheDocument();
    expect(screen.getByText('Alte Herren')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Streichen' })).toHaveLength(2);
  });

  it('streicht ein Konto (mit Bestätigung)', async () => {
    mockGetStrikeable.mockResolvedValue([makeMember(1, 'Alice Aktiv', 'aktiv')]);
    mockStrike.mockResolvedValue(makeMember(1, 'Alice Aktiv', 'aktiv', inTwoWeeks));
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Streichen' }));

    await waitFor(() => expect(mockStrike).toHaveBeenCalledWith(1));
    // Danach erscheint der Entstreichen-Button und der Streich-Hinweis.
    expect(await screen.findByRole('button', { name: 'Entstreichen' })).toBeInTheDocument();
    expect(screen.getByText(/gestrichen bis/i)).toBeInTheDocument();
  });

  it('entstreicht ein bereits gestrichenes Konto', async () => {
    mockGetStrikeable.mockResolvedValue([makeMember(1, 'Alice Aktiv', 'aktiv', inTwoWeeks)]);
    mockUnstrike.mockResolvedValue(makeMember(1, 'Alice Aktiv', 'aktiv', null));
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Entstreichen' }));

    await waitFor(() => expect(mockUnstrike).toHaveBeenCalledWith(1));
    expect(await screen.findByRole('button', { name: 'Streichen' })).toBeInTheDocument();
  });
});
