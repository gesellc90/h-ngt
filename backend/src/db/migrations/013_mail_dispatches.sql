-- M15: Versandprotokoll für den automatischen Monatsabrechnungs-Mailversand.
--
-- Jede tatsächlich versendete oder fehlgeschlagene Mail bekommt eine Zeile.
-- Zweck ist zweifach:
--   1. Idempotenz: Der Scheduler (und der "Jetzt versenden"-Button) dürfen
--      pro Abrechnungsmonat (`period`, Format "YYYY-MM") und Empfänger nur
--      einmal erfolgreich versenden — auch nach einem Neustart oder einem
--      versehentlichen zweiten Klick. Der partielle UNIQUE-Index erzwingt das
--      nur für status = 'sent'; ein fehlgeschlagener Versuch blockiert einen
--      erneuten Versuch also nicht.
--   2. Historie fürs Admin-UI ("Versandprotokoll").
--
-- kind = 'member'  → Einzelabrechnung an ein Mitglied (member_id gesetzt)
-- kind = 'summary' → Sammelabrechnung an die WK (member_id NULL)
--
-- Skip-Gründe (kein Konto, kein Verbrauch, bereits versendet) werden bewusst
-- NICHT hier gespeichert — die sind aus den Live-Daten jederzeit neu
-- berechenbar (siehe BillingMailService.run mit dryRun=true) und würden bei
-- wiederholten Vorschau-Aufrufen nur unbegrenzt Zeilen anhäufen.

CREATE TABLE mail_dispatches (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  period       TEXT    NOT NULL,
  kind         TEXT    NOT NULL CHECK (kind IN ('member', 'summary')),
  member_id    INTEGER REFERENCES members(id) ON DELETE SET NULL,
  recipient    TEXT    NOT NULL,
  status       TEXT    NOT NULL CHECK (status IN ('sent', 'failed')),
  total_cents  INTEGER,
  error        TEXT,
  message_id   TEXT,
  triggered_by TEXT    NOT NULL CHECK (triggered_by IN ('schedule', 'manual')),
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX idx_mail_dispatches_period ON mail_dispatches (period);

-- Ein Mitglied bekommt pro Monat höchstens eine erfolgreich versendete Mail.
CREATE UNIQUE INDEX idx_mail_dispatches_member_sent
  ON mail_dispatches (period, member_id)
  WHERE kind = 'member' AND status = 'sent';

-- Die Sammelabrechnung geht pro Monat höchstens einmal erfolgreich raus.
CREATE UNIQUE INDEX idx_mail_dispatches_summary_sent
  ON mail_dispatches (period)
  WHERE kind = 'summary' AND status = 'sent';
