import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from '../src/contexts/AuthContext';
import { ToastProvider } from '../src/contexts/ToastContext';
import ToastContainer from '../src/components/Toast';
import BookingPage from '../src/pages/BookingPage';
import type { BookingRow, DrinkWithCurrentPrice, PublicMember } from '../src/types/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAvailable = vi.fn();
const mockCreate = vi.fn();
const mockGetMine = vi.fn();
const mockVoid = vi.fn();

vi.mock('../src/api/drinks', () => ({
  drinksApi: {
    getAvailable: () => mockGetAvailable(),
  },
}));

vi.mock('../src/api/bookings', () => ({
  bookingsApi: {
    create: (...args: unknown[]) => mockCreate(...args),
    getMine: (...args: unknown[]) => mockGetMine(...args),
    void: (...args: unknown[]) => mockVoid(...args),
  },
}));

vi.mock('../src/api/auth', () => ({
  authApi: {
    me: vi.fn().mockResolvedValue({
      id: 1,
      username: 'test',
      display_name: 'Test',
      role: 'member',
      is_active: 1,
      member_status: 'aktiv',
      can_book_for_others: 0,
      is_wirtschaftskommission: 0,
      struck_until: null,
      email: null,
      email_verified_at: null,
      avatar_path: null,
      created_at: '',
      updated_at: '',
    } satisfies PublicMember),
    login: vi.fn(),
    logout: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Test-Daten
// ---------------------------------------------------------------------------

const drinkWasser: DrinkWithCurrentPrice = {
  id: 1,
  name: 'Wasser',
  is_available: 1,
  category_id: 1,
  category_name: 'Alkoholfrei',
  category_sort_order: 0,
  current_price_cents: 100,
  created_at: '',
  updated_at: '',
};

const drinkKaffee: DrinkWithCurrentPrice = {
  id: 2,
  name: 'Kaffee',
  is_available: 1,
  category_id: 1,
  category_name: 'Alkoholfrei',
  category_sort_order: 0,
  current_price_cents: 150,
  created_at: '',
  updated_at: '',
};

const makeBooking = (overrides: Partial<BookingRow> = {}): BookingRow => ({
  id: 10,
  member_id: 1,
  drink_id: 1,
  price_cents_snapshot: 100,
  booked_at: new Date().toISOString(),
  voided_at: null,
  void_reason: null,
  booked_by_id: null,
  ...overrides,
});

// ---------------------------------------------------------------------------
// Hilfsrenderer
// ---------------------------------------------------------------------------

function renderBookingPage() {
  localStorage.setItem('token', 'test-token');
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AuthProvider>
          <BookingPage />
          {/* ToastContainer muss explizit gerendert werden — im echten App ist er in Layout */}
          <ToastContainer />
        </AuthProvider>
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mockGetAvailable.mockResolvedValue([drinkWasser, drinkKaffee]);
  mockGetMine.mockResolvedValue({ items: [], hasMore: false });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BookingPage', () => {
  it('zeigt Getränke-Buttons nach dem Laden', async () => {
    renderBookingPage();

    expect(await screen.findByRole('button', { name: /Wasser buchen/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kaffee buchen/i })).toBeInTheDocument();
  });

  it('zeigt Preise auf den Buttons', async () => {
    renderBookingPage();

    const wasserBtn = await screen.findByRole('button', { name: /Wasser buchen/i });
    expect(wasserBtn).toHaveTextContent('1,00');
  });

  it('optimistisches Update: Buchung erscheint sofort in der Liste', async () => {
    const booking = makeBooking({ drink_id: 1 });
    mockCreate.mockResolvedValue(booking);

    renderBookingPage();
    const user = userEvent.setup();

    const wasserBtn = await screen.findByRole('button', { name: /Wasser buchen/i });
    await user.click(wasserBtn);

    // Liste sollte sofort (optimistisch) einen Eintrag zeigen
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  });

  it('zeigt Toast bei erfolgreicher Buchung', async () => {
    const booking = makeBooking({ drink_id: 1 });
    mockCreate.mockResolvedValue(booking);

    renderBookingPage();
    const user = userEvent.setup();

    const wasserBtn = await screen.findByRole('button', { name: /Wasser buchen/i });
    await user.click(wasserBtn);

    expect(await screen.findByRole('alert')).toHaveTextContent(/Wasser gebucht/i);
  });

  it('entfernt optimistischen Eintrag bei API-Fehler', async () => {
    mockCreate.mockRejectedValue(new Error('Server Error'));

    renderBookingPage();
    const user = userEvent.setup();

    const wasserBtn = await screen.findByRole('button', { name: /Wasser buchen/i });
    await user.click(wasserBtn);

    await waitFor(() => {
      expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
    });
  });

  it('zeigt bestehende Buchungen aus der Historie', async () => {
    const booking = makeBooking({ drink_id: 1 });
    mockGetMine.mockResolvedValue({ items: [booking], hasMore: false });

    renderBookingPage();

    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
  });

  it('storniert Buchung per Storno-Button', async () => {
    const booking = makeBooking({ id: 42 });
    mockGetMine.mockResolvedValue({ items: [booking], hasMore: false });
    mockVoid.mockResolvedValue({ ...booking, voided_at: new Date().toISOString() });

    renderBookingPage();
    const user = userEvent.setup();

    const stornoBtn = await screen.findByRole('button', { name: /Strich stornieren/i });
    await user.click(stornoBtn);

    expect(mockVoid).toHaveBeenCalledWith(42);
    expect(await screen.findByRole('alert')).toHaveTextContent(/storniert/i);
  });
});
