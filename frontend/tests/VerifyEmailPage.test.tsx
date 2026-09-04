import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import VerifyEmailPage from '../src/pages/VerifyEmailPage';
import { ApiError } from '../src/api/client';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockVerifyEmail = vi.fn();

vi.mock('../src/api/auth', () => ({
  authApi: {
    verifyEmail: (token: string) => mockVerifyEmail(token),
  },
}));

function renderPage(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/verify-email" element={<VerifyEmailPage />} />
        <Route path="/login" element={<div>Login-Seite</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('VerifyEmailPage', () => {
  it('zeigt eine Erfolgsmeldung bei gültigem Token', async () => {
    mockVerifyEmail.mockResolvedValue({});
    renderPage('/verify-email?token=gueltig');

    expect(await screen.findByText(/erfolgreich bestätigt/i)).toBeInTheDocument();
    expect(mockVerifyEmail).toHaveBeenCalledWith('gueltig');
    expect(screen.getByRole('link', { name: 'Zum Login' })).toBeInTheDocument();
  });

  it('zeigt eine verständliche Fehlermeldung bei abgelaufenem Token', async () => {
    mockVerifyEmail.mockRejectedValue(
      new ApiError(410, 'Bestätigungslink ist abgelaufen', 'TOKEN_EXPIRED'),
    );
    renderPage('/verify-email?token=alt');

    expect(await screen.findByRole('alert')).toHaveTextContent(/abgelaufen/i);
  });

  it('zeigt eine verständliche Fehlermeldung bei bereits benutztem Token', async () => {
    mockVerifyEmail.mockRejectedValue(new ApiError(409, 'Bereits benutzt', 'TOKEN_USED'));
    renderPage('/verify-email?token=benutzt');

    expect(await screen.findByRole('alert')).toHaveTextContent(/bereits verwendet/i);
  });

  it('zeigt eine verständliche Fehlermeldung bei geänderter Adresse', async () => {
    mockVerifyEmail.mockRejectedValue(new ApiError(409, 'Adresse geändert', 'EMAIL_CHANGED'));
    renderPage('/verify-email?token=alte-adresse');

    expect(await screen.findByRole('alert')).toHaveTextContent(/seitdem geändert/i);
  });

  it('zeigt einen Fehler ohne API-Aufruf, wenn kein Token in der URL steht', async () => {
    renderPage('/verify-email');

    expect(await screen.findByRole('alert')).toHaveTextContent(/ungültig/i);
    expect(mockVerifyEmail).not.toHaveBeenCalled();
  });

  it('zeigt einen generischen Fehler bei unbekanntem Token', async () => {
    mockVerifyEmail.mockRejectedValue(new ApiError(400, 'Ungültig', 'TOKEN_INVALID'));
    renderPage('/verify-email?token=unbekannt');

    expect(await screen.findByRole('alert')).toHaveTextContent(/ungültig/i);
  });
});
