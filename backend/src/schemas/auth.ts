import { z } from 'zod';

export const loginSchema = z.object({
  username: z.string().min(1, 'Benutzername darf nicht leer sein').max(64),
  password: z.string().min(1, 'Passwort darf nicht leer sein').max(256),
});

export type LoginInput = z.infer<typeof loginSchema>;

// ---------------------------------------------------------------------------
// POST /auth/verify-email (M16)
// ---------------------------------------------------------------------------

export const verifyEmailSchema = z.object({
  token: z.string().min(1, 'Token darf nicht leer sein').max(512),
});

export type VerifyEmailInput = z.infer<typeof verifyEmailSchema>;
