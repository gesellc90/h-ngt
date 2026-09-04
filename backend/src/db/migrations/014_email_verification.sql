-- M16: E-Mail-Verifizierung.
--
-- email_verified_at: NULL = nicht verifiziert. Wird beim Setzen/Ändern der
-- Adresse (PATCH /auth/me, PATCH /members/:id) automatisch wieder auf NULL
-- zurückgesetzt (siehe MembersRepo.update) — eine Verifizierung gilt nur für
-- exakt die Adresse, für die sie ausgestellt wurde.
--
-- email_verifications: Ausgestellte Bestätigungs-Tokens.
--   - token_hash: SHA-256 des Tokens, nie der Klartext (siehe EmailVerificationService).
--   - email: die Adresse, für die der Token gilt — wird beim Einlösen gegen die
--     AKTUELLE members.email geprüft. Ändert sich die Adresse zwischenzeitlich,
--     verifiziert ein alter Token die neue Adresse nicht (EMAIL_CHANGED).
--   - used_at: NULL = offen. Wird auch beim Entwerten (neuer Token, siehe
--     invalidateOpenForMember) gesetzt, nicht nur beim tatsächlichen Einlösen —
--     ein Mitglied soll pro Zeitpunkt höchstens einen gültigen Link haben.
--   - expires_at: 24h Gültigkeit, siehe EmailVerificationService.

ALTER TABLE members ADD COLUMN email_verified_at TEXT;

CREATE TABLE email_verifications (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  email       TEXT    NOT NULL,
  token_hash  TEXT    NOT NULL UNIQUE,
  expires_at  TEXT    NOT NULL,
  used_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
) STRICT;

CREATE INDEX idx_email_verifications_member ON email_verifications (member_id);

-- Für den periodischen Cleanup abgelaufener Tokens (pruneExpired).
CREATE INDEX idx_email_verifications_expires ON email_verifications (expires_at);
