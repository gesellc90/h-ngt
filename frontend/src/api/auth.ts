import { apiFetch, apiUpload } from './client.js';
import type { LoginResponse, PublicMember } from '../types/api.js';

export const authApi = {
  login(username: string, password: string): Promise<LoginResponse> {
    return apiFetch<LoginResponse>('/auth/login', {
      method: 'POST',
      body: { username, password },
      anonymous: true,
    });
  },

  me(): Promise<PublicMember> {
    return apiFetch<PublicMember>('/auth/me');
  },

  updateMe(data: {
    display_name?: string;
    email?: string | null;
    password?: string;
  }): Promise<PublicMember> {
    return apiFetch<PublicMember>('/auth/me', { method: 'PATCH', body: data });
  },

  uploadAvatar(file: File): Promise<PublicMember> {
    const fd = new FormData();
    fd.append('avatar', file);
    return apiUpload<PublicMember>('/auth/me/avatar', fd);
  },

  deleteAvatar(): Promise<PublicMember> {
    return apiFetch<PublicMember>('/auth/me/avatar', { method: 'DELETE' });
  },

  logout(): Promise<void> {
    return apiFetch<void>('/auth/logout', { method: 'POST' });
  },

  /** Öffentlich: löst einen Bestätigungslink ein (M16). */
  verifyEmail(token: string): Promise<PublicMember> {
    return apiFetch<PublicMember>('/auth/verify-email', {
      method: 'POST',
      body: { token },
      anonymous: true,
    });
  },

  /** "Bestätigungsmail erneut senden"-Button im Profil. */
  resendVerification(): Promise<void> {
    return apiFetch<void>('/auth/me/verify-email/resend', { method: 'POST' });
  },
};
