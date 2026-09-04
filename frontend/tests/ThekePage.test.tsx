import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../src/contexts/ToastContext';
import ToastContainer from '../src/components/Toast';
import ThekePage from '../src/pages/ThekePage';
import type {
  BookingRow,
  DrinkWithCurrentPrice,
  MemberStatus,
  PublicMember,
} from '../src/types/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAvailable = vi.fn();
const mockGetBookable = vi.fn();
const mockCreateForMember = vi.fn();
const mockGetForMember = vi.fn();
const mockVoid = vi.fn();

vi.mock('../src/api/drinks', () => ({
  drinksApi: { getAvailable: () => mockGetAvailable() },
}));

vi.mock('../src/api/members', () => ({
  membersApi: { getBookable: () => mockGetBookable() },
}));

vi.mock('../src/api/bookings', () => ({
  bookingsApi: {
    createForMember: (...args: unknown[]) => mockCreateForMember(...args),
    getForMember: (...args: unknown[]) => mockGetForMember(...args),
    void: (...args: unknown[]) => mockVoid(...args),
  },
}));

// ---------------------------------------------------------------------------
// Test-Daten
// ---------------------------------------------------------------------------

const makeMember = (
  id: number,
  display_name: string,
  member_status: MemberStatus,
): PublicMember => ({
  id,
  username: `u${id}`,
  display_name,
  role: 'member',
  is_active: 1,
  member_status,
  can_book_for_others: 0,
  is_wirtschaftskommission: 0,
  struck_until: null,
  email: null,
  email_verified_at: null,
  avatar_path: null,
  created_at: '',
  updated_at: '',
});

const drinkPils: DrinkWithCurrentPrice = {
  id: 1,
  name: 'Pils',
  is_available: 1,
  category_id: 1,
  category_name: 'Alkoholfrei',
  category_sort_order: 0,
  current_price_cents: 200,
  created_at: '',
  updated_at: '',
};

const makeBooking = (overrides: Partial<BookingRow> = {}): BookingRow => ({
  id: 10,
  member_id: 1,
  drink_id: 1,
  price_cents_snapshot: 200,
  booked_at: new Date().toISOString(),
  voided_at: null,
  void_reason: null,
  booked_by_id: 99,
  ...overrides,
});

function renderTheke() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <ThekePage />
        <ToastContainer />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAvailable.mockResolvedValue([drinkPils]);
  mockGetForMember.mockResolvedValue({ items: [], hasMore: false });
  mockGetBookable.mockResolvedValue([
    makeMember(1, 'Alice Aktiv', 'aktiv'),
    makeMember(2, 'Bob Freund', 'freund'),
  ]);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ThekePage', () => {
  it('gruppiert bebuchbare Mitglieder nach Kategorie', async () => {
    renderTheke();

    expect(await screen.findByText('Aktive')).toBeInTheDocument();
    expect(screen.getByText('Freunde der Verbindung')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Alice Aktiv' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bob Freund' })).toBeInTheDocument();
  });

  it('zeigt ein gestrichenes Konto ausgeblichen und nicht anwählbar', async () => {
    const struckUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    mockGetBookable.mockResolvedValue([
      { ...makeMember(1, 'Alice Aktiv', 'aktiv'), struck_until: struckUntil },
    ]);
    renderTheke();

    const tile = await screen.findByRole('button', { name: /Alice Aktiv/ });
    expect(tile).toBeDisabled();
    expect(screen.getByText(/gestrichen bis/i)).toBeInTheDocument();
  });

  it('filtert Mitglieder über das Suchfeld', async () => {
    renderTheke();
    const user = userEvent.setup();

    await screen.findByRole('button', { name: 'Alice Aktiv' });
    await user.type(screen.getByRole('searchbox'), 'bob');

    expect(screen.queryByRole('button', { name: 'Alice Aktiv' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bob Freund' })).toBeInTheDocument();
  });

  it('Flow: Mitglied wählen → buchen → Fertig → zurück zur Übersicht', async () => {
    mockCreateForMember.mockResolvedValue(makeBooking());
    renderTheke();
    const user = userEvent.setup();

    // Mitglied wählen
    await user.click(await screen.findByRole('button', { name: 'Alice Aktiv' }));

    // Buchungsansicht zeigt das Mitglied
    expect(await screen.findByText('Alice Aktiv')).toBeInTheDocument();

    // Strich setzen
    await user.click(await screen.findByRole('button', { name: /Pils buchen/i }));
    await waitFor(() => expect(mockCreateForMember).toHaveBeenCalledWith(1, 1));

    // Fertig → zurück zur Auswahl
    await user.click(screen.getByRole('button', { name: 'Fertig' }));
    expect(await screen.findByText('Aktive')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bob Freund' })).toBeInTheDocument();
  });
});
