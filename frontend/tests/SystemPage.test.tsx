import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../src/contexts/ToastContext';
import ToastContainer from '../src/components/Toast';
import SystemPage from '../src/pages/admin/SystemPage';
import { ApiError } from '../src/api/client';
import type { UpdateStatus } from '../src/types/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetStatus = vi.fn();
const mockRequestUpdate = vi.fn();
const mockRequestCheck = vi.fn();

vi.mock('../src/api/update', () => ({
  updateApi: {
    getStatus: () => mockGetStatus(),
    requestUpdate: () => mockRequestUpdate(),
    requestCheck: () => mockRequestCheck(),
  },
}));

// ---------------------------------------------------------------------------
// Test-Daten
// ---------------------------------------------------------------------------

const UNKNOWN_STATUS: UpdateStatus = {
  current_version: null,
  available_version: null,
  last_checked_at: null,
  last_result: 'unknown',
  last_trigger: null,
  in_progress: false,
};

const UPDATE_AVAILABLE_STATUS: UpdateStatus = {
  current_version: 'v0.5.0',
  available_version: 'v0.6.0',
  last_checked_at: '2026-07-01T03:30:00Z',
  last_result: 'update_available',
  last_trigger: 'timer',
  in_progress: false,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <SystemPage />
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

describe('SystemPage', () => {
  it('zeigt "Noch kein Update-Lauf", wenn nie ein Update lief', async () => {
    mockGetStatus.mockResolvedValue(UNKNOWN_STATUS);
    renderPage();

    expect(await screen.findByText('Noch kein Update-Lauf')).toBeInTheDocument();
    expect(screen.getByText('unbekannt')).toBeInTheDocument();
  });

  it('zeigt Versionen und "Update verfügbar", wenn eines vorliegt', async () => {
    mockGetStatus.mockResolvedValue(UPDATE_AVAILABLE_STATUS);
    renderPage();

    expect(await screen.findByText('Update verfügbar')).toBeInTheDocument();
    expect(screen.getByText('v0.5.0')).toBeInTheDocument();
    expect(screen.getByText('v0.6.0')).toBeInTheDocument();
  });

  it('stößt eine Prüfung an ("Jetzt prüfen")', async () => {
    mockGetStatus.mockResolvedValue(UNKNOWN_STATUS);
    mockRequestCheck.mockResolvedValue({ accepted: true, mode: 'check' });
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Jetzt prüfen/ }));

    await waitFor(() => expect(mockRequestCheck).toHaveBeenCalled());
    expect(await screen.findByText('Prüfung angestoßen.')).toBeInTheDocument();
  });

  it('fragt vor "Jetzt aktualisieren" eine Bestätigung ab und stößt dann das Update an', async () => {
    mockGetStatus.mockResolvedValue(UPDATE_AVAILABLE_STATUS);
    mockRequestUpdate.mockResolvedValue({ accepted: true, mode: 'update' });
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Jetzt aktualisieren/ }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockRequestUpdate).toHaveBeenCalled());
  });

  it('installiert nicht, wenn die Bestätigung abgelehnt wird', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockGetStatus.mockResolvedValue(UPDATE_AVAILABLE_STATUS);
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Jetzt aktualisieren/ }));

    expect(mockRequestUpdate).not.toHaveBeenCalled();
  });

  it('zeigt einen verständlichen Fehler, wenn bereits ein Update läuft (409)', async () => {
    mockGetStatus.mockResolvedValue(UNKNOWN_STATUS);
    mockRequestCheck.mockRejectedValue(
      new ApiError(409, 'Ein Update läuft bereits', 'UPDATE_IN_PROGRESS'),
    );
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Jetzt prüfen/ }));

    expect(await screen.findByText('Es läuft bereits ein Update-Vorgang.')).toBeInTheDocument();
  });

  it('deaktiviert beide Buttons, solange ein Update läuft', async () => {
    mockGetStatus.mockResolvedValue({
      ...UPDATE_AVAILABLE_STATUS,
      last_result: 'in_progress',
      in_progress: true,
    });
    renderPage();

    expect(await screen.findByRole('button', { name: /Jetzt prüfen/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Jetzt aktualisieren/ })).toBeDisabled();
  });
});
