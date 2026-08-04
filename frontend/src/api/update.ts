import { apiFetch } from './client.js';
import type { UpdateStatus } from '../types/api.js';

export const updateApi = {
  /** Admin: aktuellen Update-Status abrufen (vom Pi-Helper zuletzt geschrieben). */
  getStatus(): Promise<UpdateStatus> {
    return apiFetch<UpdateStatus>('/update/status');
  },

  /** Admin: „Jetzt aktualisieren" — schreibt nur einen Marker, installiert nichts direkt. */
  requestUpdate(): Promise<{ accepted: true; mode: 'update' }> {
    return apiFetch('/update', { method: 'POST' });
  },

  /** Admin: „Jetzt prüfen" — wie requestUpdate, aber ohne Installation. */
  requestCheck(): Promise<{ accepted: true; mode: 'check' }> {
    return apiFetch('/update/check', { method: 'POST' });
  },
};
