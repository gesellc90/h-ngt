import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider } from '../../src/contexts/ToastContext';
import MembersPage from '../../src/pages/admin/MembersPage';
import type { PublicMember } from '../../src/types/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetAll = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDeactivate = vi.fn();

vi.mock('../../src/api/members', () => ({
  membersApi: {
    getAll: (...a: unknown[]) => mockGetAll(...a),
    create: (...a: unknown[]) => mockCreate(...a),
    update: (...a: unknown[]) => mockUpdate(...a),
    deactivate: (...a: unknown[]) => mockDeactivate(...a),
  },
}));

function member(overrides: Partial<PublicMember> = {}): PublicMember {
  return {
    id: 1,
    username: 'anna',
    display_name: 'Anna Muster',
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

function renderPage() {
  return render(
    <ToastProvider>
      <MembersPage />
    </ToastProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MembersPage', () => {
  it('lädt Mitglieder und zeigt sie in der Tabelle', async () => {
    mockGetAll.mockResolvedValue([member(), member({ id: 2, display_name: 'Bernd Beispiel' })]);

    renderPage();

    expect(await screen.findByText('Anna Muster')).toBeInTheDocument();
    expect(screen.getByText('Bernd Beispiel')).toBeInTheDocument();
    expect(mockGetAll).toHaveBeenCalledWith(false);
  });

  it('zeigt einen Leer-Hinweis, wenn keine Mitglieder existieren', async () => {
    mockGetAll.mockResolvedValue([]);

    renderPage();

    expect(await screen.findByText(/Keine Mitglieder gefunden/i)).toBeInTheDocument();
  });

  it('lädt inaktive Mitglieder nach, wenn die Checkbox aktiviert wird', async () => {
    mockGetAll.mockResolvedValue([member()]);

    renderPage();
    await screen.findByText('Anna Muster');

    await userEvent.click(screen.getByLabelText(/Inaktive anzeigen/i));

    await waitFor(() => expect(mockGetAll).toHaveBeenCalledWith(true));
  });

  it('legt über das Formular ein neues Mitglied an', async () => {
    mockGetAll.mockResolvedValue([]);
    mockCreate.mockResolvedValue(member({ id: 9, display_name: 'Carla Neu', username: 'carla' }));

    const { container } = renderPage();
    await screen.findByText(/Keine Mitglieder gefunden/i);

    await userEvent.click(screen.getByRole('button', { name: /Mitglied anlegen/i }));

    // Die Formular-Labels sind nicht via htmlFor/id verknüpft → über name-Attribut ansteuern.
    const byName = (name: string) =>
      container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!;
    await userEvent.type(byName('display_name'), 'Carla Neu');
    await userEvent.type(byName('username'), 'carla');
    await userEvent.type(byName('password'), 'geheim123');
    await userEvent.click(screen.getByRole('button', { name: 'Anlegen' }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          username: 'carla',
          display_name: 'Carla Neu',
          password: 'geheim123',
        }),
      ),
    );
    expect(await screen.findByText('Carla Neu')).toBeInTheDocument();
  });

  it('ändert die Kategorie eines Mitglieds über das Dropdown', async () => {
    mockGetAll.mockResolvedValue([member()]);
    mockUpdate.mockResolvedValue(member({ member_status: 'alter_herr' }));

    renderPage();
    await screen.findByText('Anna Muster');

    await userEvent.selectOptions(
      screen.getByLabelText(/Kategorie von Anna Muster/i),
      'alter_herr',
    );

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(1, { member_status: 'alter_herr' }),
    );
  });

  it('deaktiviert ein Mitglied nach Bestätigung', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    mockGetAll.mockResolvedValue([member()]);
    mockDeactivate.mockResolvedValue(undefined);

    renderPage();
    const row = (await screen.findByText('Anna Muster')).closest('tr')!;

    await userEvent.click(within(row).getByRole('button', { name: /Deaktivieren/i }));

    await waitFor(() => expect(mockDeactivate).toHaveBeenCalledWith(1));
  });

  it('deaktiviert NICHT, wenn die Bestätigung abgebrochen wird', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockGetAll.mockResolvedValue([member()]);

    renderPage();
    const row = (await screen.findByText('Anna Muster')).closest('tr')!;

    await userEvent.click(within(row).getByRole('button', { name: /Deaktivieren/i }));

    expect(mockDeactivate).not.toHaveBeenCalled();
  });
});
