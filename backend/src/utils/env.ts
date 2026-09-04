import { z } from 'zod';

/**
 * Bool'sche ENV-Variable robust parsen.
 * `z.coerce.boolean()` wäre hier ein Footgun: `Boolean("false")` ist `true`,
 * weil jeder nicht-leere String truthy ist – `MAIL_ENABLED=false` würde also
 * fälschlich aktivieren. Stattdessen nur "true"/"false" akzeptieren.
 */
function boolEnv(defaultValue: boolean) {
  return z
    .enum(['true', 'false'])
    .default(defaultValue ? 'true' : 'false')
    .transform((v) => v === 'true');
}

/**
 * Schema für die ENV-Variablen des Backends.
 * Wird beim Start in `server.ts` einmal validiert — fehlende oder ungültige
 * Werte führen zu einem klaren Fehler statt zu unerklärlichem Verhalten zur Laufzeit.
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3001),
    LOG_LEVEL: z
      .enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'silent'])
      .default('info'),
    /** Pfad zur SQLite-Datei. `:memory:` ist gültig (für Tests). */
    DB_PATH: z.string().default('./data/getraenke.db'),
    /** Mindestens 32 Zeichen – zufälliger String, nie in die Versionskontrolle! */
    JWT_SECRET: z.string().min(32, 'JWT_SECRET muss mindestens 32 Zeichen lang sein'),
    JWT_EXPIRES_IN: z.string().default('8h'),
    /** Verzeichnis für Profilbilder. Wird beim Start angelegt wenn nicht vorhanden. */
    AVATAR_DIR: z.string().default('./data/avatars'),
    /**
     * Verzeichnis für den Auto-Update-Rückkanal (M14): `update-status.json`
     * (vom Pi-Helper geschrieben) und `update-requested` (Marker-Datei, von
     * dieser App geschrieben). Muss auf dem Pi mit dem StateDirectory des
     * Helpers übereinstimmen (`/var/lib/getraenke`) — siehe docs/AUTO-UPDATE.md.
     */
    UPDATE_STATE_DIR: z.string().default('./data'),
    /**
     * Anzahl vertrauenswürdiger Reverse-Proxy-Hops vor der App (Express `trust proxy`).
     * 0 = kein Proxy (Default, sicher). Hinter Caddy/nginx auf `1` setzen, damit das
     * Rate-Limiting die echte Client-IP statt der Proxy-IP sieht. NICHT auf > 0
     * setzen, wenn KEIN Proxy davor sitzt – sonst wird X-Forwarded-For spoofbar.
     */
    TRUST_PROXY: z.coerce.number().int().min(0).default(0),

    /**
     * M15 — automatischer Mailversand der Monatsabrechnungen.
     * Master-Schalter, Default aus: ohne MAIL_ENABLED=true passiert nichts,
     * auch wenn SMTP-Zugangsdaten gesetzt sind.
     */
    MAIL_ENABLED: boolEnv(false),
    /** Postausgangsserver. Default passt zu df.eu (sslout.df.eu:465, SSL/TLS). */
    SMTP_HOST: z.string().default('sslout.df.eu'),
    SMTP_PORT: z.coerce.number().int().positive().default(465),
    /** true = implizites TLS (Port 465). false = STARTTLS (typischerweise Port 587). */
    SMTP_SECURE: boolEnv(true),
    SMTP_USER: z.string().default(''),
    /** Niemals loggen oder in Fehlermeldungen zurückgeben — siehe MailService. */
    SMTP_PASS: z.string().default(''),
    /** Absenderadresse (Envelope-From), z. B. `"Hängt! <bierwart-app@nassovia.de>"`. */
    MAIL_FROM: z.string().default(''),
    /** Empfänger der Sammelabrechnung (alle Mitglieder + alle Zeiger des Monats). */
    MAIL_SUMMARY_TO: z.string().default(''),
    /** Optionale CC-Adresse(n) der Sammelabrechnung, kommagetrennt. */
    MAIL_SUMMARY_CC: z.string().default(''),
    /** Zweiter Schalter: erst nach erfolgreichem manuellem Test scharfschalten. */
    MAIL_SCHEDULE_ENABLED: boolEnv(false),
    /** Stunde (0–23, Europe/Berlin) am 1. des Monats, ab der der Vormonat versendet wird. */
    MAIL_SCHEDULE_HOUR: z.coerce.number().int().min(0).max(23).default(3),
  })
  .superRefine((data, ctx) => {
    // Nur wenn der Mailversand aktiv scharfgeschaltet ist, sind die
    // SMTP-Zugangsdaten und Empfänger Pflicht – sonst bleibt die App startbar,
    // auch ohne dass diese Werte schon feststehen (z. B. vor der Inbetriebnahme).
    if (!data.MAIL_ENABLED) return;
    const required: (keyof typeof data)[] = [
      'SMTP_USER',
      'SMTP_PASS',
      'MAIL_FROM',
      'MAIL_SUMMARY_TO',
    ];
    for (const key of required) {
      if (!data[key]) {
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: `${key} ist Pflicht, wenn MAIL_ENABLED=true gesetzt ist`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Ungültige ENV-Konfiguration:\n${issues}`);
  }
  return parsed.data;
}
