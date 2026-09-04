import type { Db } from '../client.js';
import type { EmailVerificationRow } from '../types.js';

export interface CreateEmailVerificationInput {
  member_id: number;
  email: string;
  token_hash: string;
  expires_at: string;
}

export class EmailVerificationRepo {
  constructor(private readonly db: Db) {}

  create(input: CreateEmailVerificationInput): EmailVerificationRow {
    const result = this.db
      .prepare(
        `INSERT INTO email_verifications (member_id, email, token_hash, expires_at)
         VALUES (@member_id, @email, @token_hash, @expires_at)`,
      )
      .run(input);

    return this.db
      .prepare<
        [number | bigint],
        EmailVerificationRow
      >('SELECT * FROM email_verifications WHERE id = ?')
      .get(result.lastInsertRowid)!;
  }

  findByTokenHash(tokenHash: string): EmailVerificationRow | undefined {
    return this.db
      .prepare<
        [string],
        EmailVerificationRow
      >('SELECT * FROM email_verifications WHERE token_hash = ?')
      .get(tokenHash);
  }

  /** Markiert einen Token als eingelöst (Einmal-Nutzung). */
  markUsed(id: number): void {
    this.db
      .prepare(
        "UPDATE email_verifications SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?",
      )
      .run(id);
  }

  /**
   * Entwertet alle noch offenen Tokens eines Mitglieds — aufgerufen beim
   * Ausstellen eines neuen Tokens, damit pro Mitglied höchstens ein
   * gültiger Bestätigungslink existiert (alte Links in bereits verschickten
   * Mails werden damit ungültig).
   */
  invalidateOpenForMember(memberId: number): void {
    this.db
      .prepare(
        `UPDATE email_verifications
         SET used_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
         WHERE member_id = ? AND used_at IS NULL`,
      )
      .run(memberId);
  }

  /** Löscht alle abgelaufenen Einträge (Cleanup, analog TokenBlocklistRepo). */
  pruneExpired(): number {
    const result = this.db
      .prepare(
        "DELETE FROM email_verifications WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
      )
      .run();
    return result.changes;
  }
}
