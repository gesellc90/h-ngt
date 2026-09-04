import { apiFetch } from './client.js';
import type { MailStatus, MailRunResult, MailDispatchRow } from '../types/api.js';

export const mailApi = {
  /** Admin: Konfiguration des Mailversands (ohne Zugangsdaten). */
  getStatus(): Promise<MailStatus> {
    return apiFetch<MailStatus>('/mail/status');
  },

  /** Admin: Testmail an eine frei wählbare Adresse — prüft die SMTP-Verbindung. */
  sendTest(to: string): Promise<{ ok: true; messageId?: string }> {
    return apiFetch('/mail/test', { method: 'POST', body: { to } });
  },

  /** Admin: Dry-Run — wer bekäme für diesen Monat was, ohne dass etwas versendet wird. */
  preview(year: number, month: number): Promise<MailRunResult> {
    const qs = new URLSearchParams({ year: String(year), month: String(month) });
    return apiFetch<MailRunResult>(`/mail/preview?${qs}`);
  },

  /** Admin: "Jetzt versenden" — idempotent, bereits versendete Empfänger werden übersprungen. */
  dispatch(year: number, month: number): Promise<MailRunResult> {
    return apiFetch('/mail/dispatch', { method: 'POST', body: { year, month } });
  },

  /** Admin: Versandprotokoll für einen Monat. */
  getDispatches(year: number, month: number): Promise<MailDispatchRow[]> {
    const qs = new URLSearchParams({ year: String(year), month: String(month) });
    return apiFetch<MailDispatchRow[]>(`/mail/dispatches?${qs}`);
  },
};
