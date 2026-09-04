import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../src/contexts/ToastContext';
import ToastContainer from '../src/components/Toast';
import MailPage from '../src/pages/admin/MailPage';
import { ApiError } from '../src/api/client';
import type { MailStatus, MailRunResult, MailDispatchRow } from '../src/types/api';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetStatus = vi.fn();
const mockSendTest = vi.fn();
const mockPreview = vi.fn();
const mockDispatch = vi.fn();
const mockGetDispatches = vi.fn();

vi.mock('../src/api/mail', () => ({
  mailApi: {
    getStatus: () => mockGetStatus(),
    sendTest: (to: string) => mockSendTest(to),
    preview: (year: number, month: number) => mockPreview(year, month),
    dispatch: (year: number, month: number) => mockDispatch(year, month),
    getDispatches: (year: number, month: number) => mockGetDispatches(year, month),
  },
}));

// ---------------------------------------------------------------------------
// Test-Daten
// ---------------------------------------------------------------------------

const DISABLED_STATUS: MailStatus = {
  enabled: false,
  scheduleEnabled: false,
  scheduleHour: 3,
  smtpHost: 'sslout.df.eu',
  smtpPort: 465,
  smtpSecure: true,
  summaryTo: null,
  summaryCc: [],
};

const ENABLED_STATUS: MailStatus = {
  enabled: true,
  scheduleEnabled: true,
  scheduleHour: 3,
  smtpHost: 'sslout.df.eu',
  smtpPort: 465,
  smtpSecure: true,
  summaryTo: 'xxxx@nassovia.de',
  summaryCc: ['wk@nassovia.de'],
};

const PREVIEW_RESULT: MailRunResult = {
  period: '2026-05',
  lines: [
    {
      kind: 'member',
      memberId: 1,
      displayName: 'Alice',
      recipient: 'alice@example.org',
      status: 'planned',
      totalCents: 490,
    },
    {
      kind: 'member',
      memberId: 2,
      displayName: 'Bob',
      recipient: null,
      status: 'skipped',
      reason: 'Keine E-Mail-Adresse hinterlegt',
    },
    {
      kind: 'summary',
      memberId: null,
      displayName: null,
      recipient: 'xxxx@nassovia.de',
      status: 'planned',
    },
  ],
};

const EMPTY_DISPATCHES: MailDispatchRow[] = [];

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <MailPage />
        <ToastContainer />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(window, 'confirm').mockReturnValue(true);
  mockGetDispatches.mockResolvedValue(EMPTY_DISPATCHES);
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MailPage', () => {
  it('zeigt "Versand deaktiviert", wenn MAIL_ENABLED=false ist', async () => {
    mockGetStatus.mockResolvedValue(DISABLED_STATUS);
    renderPage();

    expect(await screen.findByText(/Versand deaktiviert/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Jetzt versenden/ })).toBeDisabled();
  });

  it('zeigt SMTP-Ziel und Sammel-Empfänger, wenn aktiviert', async () => {
    mockGetStatus.mockResolvedValue(ENABLED_STATUS);
    renderPage();

    expect(await screen.findByText('Versand aktiviert')).toBeInTheDocument();
    expect(screen.getByText(/sslout\.df\.eu:465/)).toBeInTheDocument();
    expect(screen.getByText(/xxxx@nassovia\.de/)).toBeInTheDocument();
  });

  it('sendet eine Testmail an die eingegebene Adresse', async () => {
    mockGetStatus.mockResolvedValue(ENABLED_STATUS);
    mockSendTest.mockResolvedValue({ ok: true });
    renderPage();
    const user = userEvent.setup();

    const input = await screen.findByLabelText('Testmail an');
    await user.type(input, 'admin@example.org');
    await user.click(screen.getByRole('button', { name: /Testmail senden/ }));

    await waitFor(() => expect(mockSendTest).toHaveBeenCalledWith('admin@example.org'));
    expect(await screen.findByText(/Testmail an admin@example.org versendet/)).toBeInTheDocument();
  });

  it('zeigt einen verständlichen Fehler, wenn der Mailversand deaktiviert ist (MAIL_DISABLED)', async () => {
    mockGetStatus.mockResolvedValue(DISABLED_STATUS);
    mockSendTest.mockRejectedValue(
      new ApiError(503, 'Mailversand ist nicht aktiviert', 'MAIL_DISABLED'),
    );
    renderPage();
    const user = userEvent.setup();

    const input = await screen.findByLabelText('Testmail an');
    await user.type(input, 'admin@example.org');
    await user.click(screen.getByRole('button', { name: /Testmail senden/ }));

    expect(
      await screen.findByText('Mailversand ist nicht aktiviert (MAIL_ENABLED=false).'),
    ).toBeInTheDocument();
  });

  it('lädt und zeigt die Vorschau (Dry-Run) mit Empfängern und Skip-Gründen', async () => {
    mockGetStatus.mockResolvedValue(ENABLED_STATUS);
    mockPreview.mockResolvedValue(PREVIEW_RESULT);
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Vorschau \(Dry-Run\)/ }));

    await waitFor(() => expect(mockPreview).toHaveBeenCalled());
    expect(await screen.findByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('Keine E-Mail-Adresse hinterlegt')).toBeInTheDocument();
    expect(screen.getByText('Sammelabrechnung (WK)')).toBeInTheDocument();
  });

  it('fragt vor "Jetzt versenden" eine Bestätigung ab und löst dann den Versand aus', async () => {
    mockGetStatus.mockResolvedValue(ENABLED_STATUS);
    mockDispatch.mockResolvedValue({
      period: '2026-05',
      lines: [
        { kind: 'summary', memberId: null, displayName: null, recipient: 'x', status: 'sent' },
      ],
    });
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Jetzt versenden/ }));

    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(mockDispatch).toHaveBeenCalled());
  });

  it('versendet nicht, wenn die Bestätigung abgelehnt wird', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    mockGetStatus.mockResolvedValue(ENABLED_STATUS);
    renderPage();
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: /Jetzt versenden/ }));

    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it('zeigt "noch nichts versendet", wenn das Protokoll für den Monat leer ist', async () => {
    mockGetStatus.mockResolvedValue(ENABLED_STATUS);
    renderPage();

    expect(await screen.findByText(/wurde noch nichts versendet/)).toBeInTheDocument();
  });

  it('zeigt das Versandprotokoll mit Status und Fehlermeldung', async () => {
    mockGetStatus.mockResolvedValue(ENABLED_STATUS);
    mockGetDispatches.mockResolvedValue([
      {
        id: 1,
        period: '2026-05',
        kind: 'member',
        member_id: 1,
        recipient: 'alice@example.org',
        status: 'failed',
        total_cents: 490,
        error: 'SMTP-Fehler',
        message_id: null,
        triggered_by: 'manual',
        created_at: '2026-05-01T03:00:00.000Z',
      } satisfies MailDispatchRow,
    ]);
    renderPage();

    expect(await screen.findByText('alice@example.org')).toBeInTheDocument();
    expect(screen.getByText('SMTP-Fehler')).toBeInTheDocument();
    expect(screen.getByText('Fehlgeschlagen')).toBeInTheDocument();
  });
});
