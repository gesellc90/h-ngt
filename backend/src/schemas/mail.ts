import { z } from 'zod';

const currentYear = new Date().getFullYear();

const yearMonthQuerySchema = z.object({
  year: z
    .string()
    .regex(/^\d{4}$/, 'year muss vierstellig sein')
    .transform(Number)
    .pipe(
      z
        .number()
        .int()
        .min(2020)
        .max(currentYear + 1),
    ),
  month: z
    .string()
    .regex(/^(1[0-2]|[1-9])$/, 'month muss zwischen 1 und 12 liegen')
    .transform(Number)
    .pipe(z.number().int().min(1).max(12)),
});

// ---------------------------------------------------------------------------
// GET /mail/preview?year=&month=
// GET /mail/dispatches?year=&month=
// ---------------------------------------------------------------------------

export const mailPeriodQuerySchema = yearMonthQuerySchema;
export type MailPeriodQuery = z.infer<typeof mailPeriodQuerySchema>;

// ---------------------------------------------------------------------------
// POST /mail/dispatch
// ---------------------------------------------------------------------------

export const mailDispatchBodySchema = z.object({
  year: z
    .number()
    .int()
    .min(2020)
    .max(currentYear + 1),
  month: z.number().int().min(1).max(12),
});
export type MailDispatchBody = z.infer<typeof mailDispatchBodySchema>;

// ---------------------------------------------------------------------------
// POST /mail/test
// ---------------------------------------------------------------------------

export const mailTestBodySchema = z.object({
  to: z.string().trim().email('Ungültige E-Mail-Adresse').max(254),
});
export type MailTestBody = z.infer<typeof mailTestBodySchema>;
