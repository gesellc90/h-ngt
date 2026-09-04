import type { Db } from '../client.js';
import type { MemberRow, MemberStatus } from '../types.js';

export interface CreateMemberInput {
  username: string;
  display_name: string;
  password_hash?: string | null;
  role?: 'admin' | 'member';
  member_status?: MemberStatus;
  can_book_for_others?: 0 | 1;
  is_wirtschaftskommission?: 0 | 1;
  email?: string | null;
}

export interface UpdateMemberInput {
  display_name?: string;
  password_hash?: string | null;
  role?: 'admin' | 'member';
  is_active?: 0 | 1;
  member_status?: MemberStatus;
  can_book_for_others?: 0 | 1;
  is_wirtschaftskommission?: 0 | 1;
  email?: string | null;
  avatar_path?: string | null;
}

export class MembersRepo {
  constructor(private readonly db: Db) {}

  findById(id: number): MemberRow | undefined {
    return this.db.prepare<[number], MemberRow>('SELECT * FROM members WHERE id = ?').get(id);
  }

  findByUsername(username: string): MemberRow | undefined {
    return this.db
      .prepare<[string], MemberRow>('SELECT * FROM members WHERE username = ? COLLATE NOCASE')
      .get(username);
  }

  findAll(includeInactive = false): MemberRow[] {
    const sql = includeInactive
      ? 'SELECT * FROM members ORDER BY display_name'
      : 'SELECT * FROM members WHERE is_active = 1 ORDER BY display_name';
    return this.db.prepare<[], MemberRow>(sql).all();
  }

  findByEmail(email: string): MemberRow | undefined {
    return this.db
      .prepare<[string], MemberRow>('SELECT * FROM members WHERE email = ? COLLATE NOCASE')
      .get(email);
  }

  create(input: CreateMemberInput): MemberRow {
    const result = this.db
      .prepare(
        `INSERT INTO members
           (username, display_name, password_hash, role, member_status, can_book_for_others, is_wirtschaftskommission, email)
         VALUES
           (@username, @display_name, @password_hash, @role, @member_status, @can_book_for_others, @is_wirtschaftskommission, @email)`,
      )
      .run({
        username: input.username,
        display_name: input.display_name,
        password_hash: input.password_hash ?? null,
        role: input.role ?? 'member',
        member_status: input.member_status ?? 'aktiv',
        can_book_for_others: input.can_book_for_others ?? 0,
        is_wirtschaftskommission: input.is_wirtschaftskommission ?? 0,
        email: input.email ?? null,
      });

    return this.findById(result.lastInsertRowid as number)!;
  }

  update(id: number, input: UpdateMemberInput): MemberRow | undefined {
    const existing = this.findById(id);
    if (!existing) return undefined;

    // Eine Verifizierung gilt nur für die Adresse, für die sie ausgestellt
    // wurde (M16) — bei jeder tatsächlichen Änderung der E-Mail-Adresse wird
    // email_verified_at hier zentral zurückgesetzt, unabhängig davon, ob der
    // Aufruf von PATCH /auth/me oder PATCH /members/:id kommt.
    const emailChanged = input.email !== undefined && input.email !== existing.email;

    this.db
      .prepare(
        `UPDATE members
         SET display_name             = @display_name,
             password_hash            = @password_hash,
             role                     = @role,
             is_active                = @is_active,
             member_status            = @member_status,
             can_book_for_others      = @can_book_for_others,
             is_wirtschaftskommission = @is_wirtschaftskommission,
             email                    = @email,
             email_verified_at        = @email_verified_at,
             avatar_path              = @avatar_path
         WHERE id = @id`,
      )
      .run({
        id,
        display_name: input.display_name ?? existing.display_name,
        password_hash:
          input.password_hash !== undefined ? input.password_hash : existing.password_hash,
        role: input.role ?? existing.role,
        is_active: input.is_active ?? existing.is_active,
        member_status: input.member_status ?? existing.member_status,
        can_book_for_others: input.can_book_for_others ?? existing.can_book_for_others,
        is_wirtschaftskommission:
          input.is_wirtschaftskommission ?? existing.is_wirtschaftskommission,
        email: input.email !== undefined ? input.email : existing.email,
        email_verified_at: emailChanged ? null : existing.email_verified_at,
        avatar_path: input.avatar_path !== undefined ? input.avatar_path : existing.avatar_path,
      });

    return this.findById(id);
  }

  /**
   * Markiert die aktuell hinterlegte E-Mail-Adresse als verifiziert.
   * Getrennt von `update()`, weil dieser Aufruf selbst KEINE Änderung an
   * `email` ist und daher `email_verified_at` nicht wieder auf NULL
   * zurücksetzen darf.
   */
  markEmailVerified(id: number, verifiedAt: string): void {
    this.db.prepare('UPDATE members SET email_verified_at = ? WHERE id = ?').run(verifiedAt, id);
  }

  /**
   * Bebuchbare Mitglieder für den Theken-/Allgemein-Modus.
   *
   * Liefert aktive (is_active = 1) Mitglieder der Rolle 'member', die NICHT
   * selbst ein Buchen-für-andere-Konto sind. Die Kategorie (member_status) ist
   * unabhängig von is_active – ein "Freund" ohne Login bleibt also bebuchbar.
   * Sortiert nach Kategorie (Aktive → Inaktive → Alte Herren → Freunde),
   * dann nach Anzeigename.
   */
  findBookable(): MemberRow[] {
    return this.db
      .prepare<[], MemberRow>(
        `SELECT * FROM members
         WHERE is_active = 1 AND role = 'member' AND can_book_for_others = 0
         ORDER BY
           CASE member_status
             WHEN 'aktiv'      THEN 0
             WHEN 'inaktiv'    THEN 1
             WHEN 'alter_herr' THEN 2
             WHEN 'freund'     THEN 3
             ELSE 4
           END,
           display_name COLLATE NOCASE`,
      )
      .all();
  }

  /** Soft-Delete: setzt is_active = 0. */
  deactivate(id: number): boolean {
    const result = this.db.prepare('UPDATE members SET is_active = 0 WHERE id = ?').run(id);
    return result.changes > 0;
  }

  /**
   * Streicht ein Konto bis zum angegebenen ISO-Zeitpunkt (keine Personenbuchungen
   * bis dahin). Setzt `struck_until`; ein bestehender Wert wird überschrieben
   * (erneutes Streichen verlängert die Frist).
   */
  setStruckUntil(id: number, until: string | null): boolean {
    const result = this.db
      .prepare('UPDATE members SET struck_until = ? WHERE id = ?')
      .run(until, id);
    return result.changes > 0;
  }
}
