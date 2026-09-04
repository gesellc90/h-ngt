import bcrypt from 'bcryptjs';
import { BCRYPT_COST } from './AuthService.js';
import type { MembersRepo } from '../db/repos/MembersRepo.js';
import type { AuditLogRepo } from '../db/repos/AuditLogRepo.js';
import type { EmailVerificationService } from './EmailVerificationService.js';
import type { MemberRow, MemberStatus } from '../db/types.js';
import { AppError } from '../middleware/errorHandler.js';

// Re-Export für Bestandsimporte (Routen importieren toPublicMember von hier).
export { toPublicMember, type PublicMember } from './publicMember.js';

/** Reguläre Streich-Dauer: 2 Wochen (14 Tage). */
export const STRIKE_DURATION_MS = 14 * 24 * 60 * 60 * 1000;

/** True, wenn das Konto aktuell (zum Zeitpunkt `now`) gestrichen ist. */
export function isStruck(member: MemberRow, now: number = Date.now()): boolean {
  return member.struck_until !== null && new Date(member.struck_until).getTime() > now;
}

// ---------------------------------------------------------------------------
// MembersService — Business-Logik für Mitgliederverwaltung
// ---------------------------------------------------------------------------

export class MembersService {
  constructor(
    private readonly members: MembersRepo,
    private readonly auditLog: AuditLogRepo,
    private readonly emailVerification: EmailVerificationService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lesen
  // ---------------------------------------------------------------------------

  findAll(includeInactive = false): MemberRow[] {
    return this.members.findAll(includeInactive);
  }

  /** Bebuchbare Mitglieder für den Theken-/Allgemein-Modus, sortiert nach Kategorie. */
  findBookable(): MemberRow[] {
    return this.members.findBookable();
  }

  /**
   * Streichbare Konten für die Wirtschaftskommission — dieselbe Population wie
   * die bebuchbaren Personen-Konten (aktive Mitglieder, kein Theken-Konto),
   * inklusive bereits gestrichener (damit sie entstrichen werden können).
   */
  findStrikeable(): MemberRow[] {
    return this.members.findBookable();
  }

  findById(id: number): MemberRow {
    const member = this.members.findById(id);
    if (!member) {
      throw new AppError('Mitglied nicht gefunden', 404, 'NOT_FOUND');
    }
    return member;
  }

  // ---------------------------------------------------------------------------
  // Anlegen
  // ---------------------------------------------------------------------------

  async create(
    input: {
      username: string;
      display_name: string;
      password: string;
      role?: 'admin' | 'member';
      member_status?: MemberStatus;
      is_wirtschaftskommission?: boolean;
      email?: string;
    },
    actorId: number,
  ): Promise<MemberRow> {
    const existing = this.members.findByUsername(input.username);
    if (existing) {
      throw new AppError('Username bereits vergeben', 409, 'USERNAME_TAKEN');
    }

    if (input.email) {
      const emailTaken = this.members.findByEmail(input.email);
      if (emailTaken) {
        throw new AppError('E-Mail-Adresse bereits vergeben', 409, 'EMAIL_TAKEN');
      }
    }

    const password_hash = await bcrypt.hash(input.password, BCRYPT_COST);

    const member = this.members.create({
      username: input.username,
      display_name: input.display_name,
      password_hash,
      role: input.role ?? 'member',
      member_status: input.member_status ?? 'aktiv',
      is_wirtschaftskommission: input.is_wirtschaftskommission ? 1 : 0,
      email: input.email ?? null,
    });

    this.auditLog.create({
      event_type: 'member_created',
      actor_id: actorId,
      target_type: 'member',
      target_id: member.id,
      meta: {
        username: input.username,
        role: input.role ?? 'member',
        member_status: input.member_status ?? 'aktiv',
        is_wirtschaftskommission: input.is_wirtschaftskommission ?? false,
      },
    });

    return member;
  }

  // ---------------------------------------------------------------------------
  // Aktualisieren
  // ---------------------------------------------------------------------------

  async update(
    id: number,
    input: {
      display_name?: string;
      password?: string;
      role?: 'admin' | 'member';
      member_status?: MemberStatus;
      can_book_for_others?: boolean;
      is_wirtschaftskommission?: boolean;
      email?: string | null;
      avatar_path?: string | null;
    },
    actorId: number,
  ): Promise<MemberRow> {
    const existing = this.members.findById(id);
    if (!existing) {
      throw new AppError('Mitglied nicht gefunden', 404, 'NOT_FOUND');
    }

    if (input.email !== undefined && input.email !== null) {
      const emailTaken = this.members.findByEmail(input.email);
      if (emailTaken && emailTaken.id !== id) {
        throw new AppError('E-Mail-Adresse bereits vergeben', 409, 'EMAIL_TAKEN');
      }
    }

    let password_hash: string | undefined = undefined;
    if (input.password !== undefined) {
      password_hash = await bcrypt.hash(input.password, BCRYPT_COST);
    }

    const updated = this.members.update(id, {
      display_name: input.display_name,
      password_hash,
      role: input.role,
      member_status: input.member_status,
      can_book_for_others:
        input.can_book_for_others === undefined ? undefined : input.can_book_for_others ? 1 : 0,
      is_wirtschaftskommission:
        input.is_wirtschaftskommission === undefined
          ? undefined
          : input.is_wirtschaftskommission
            ? 1
            : 0,
      email: input.email,
      avatar_path: input.avatar_path,
    });

    this.auditLog.create({
      event_type: 'member_updated',
      actor_id: actorId,
      target_type: 'member',
      target_id: id,
      meta: {
        changed_fields: [
          ...(input.display_name !== undefined ? ['display_name'] : []),
          ...(input.password !== undefined ? ['password'] : []),
          ...(input.role !== undefined ? ['role'] : []),
          ...(input.member_status !== undefined ? ['member_status'] : []),
          ...(input.can_book_for_others !== undefined ? ['can_book_for_others'] : []),
          ...(input.is_wirtschaftskommission !== undefined ? ['is_wirtschaftskommission'] : []),
          ...(input.email !== undefined ? ['email'] : []),
          ...(input.avatar_path !== undefined ? ['avatar_path'] : []),
        ],
      },
    });

    // Adresse gesetzt/geändert → MembersRepo.update hat email_verified_at
    // bereits zurückgesetzt; hier den neuen Bestätigungslink verschicken.
    // Ein leeres/entferntes email (null) braucht keine Verifizierungsmail.
    if (input.email !== undefined && input.email !== null && input.email !== existing.email) {
      await this.emailVerification.issueAndSend(updated!, actorId);
    }

    return updated!;
  }

  // ---------------------------------------------------------------------------
  // Soft-Delete (Deaktivieren)
  // ---------------------------------------------------------------------------

  deactivate(id: number, actorId: number): void {
    if (id === actorId) {
      throw new AppError('Eigenes Konto kann nicht deaktiviert werden', 400, 'SELF_DEACTIVATION');
    }

    const member = this.members.findById(id);
    if (!member) {
      throw new AppError('Mitglied nicht gefunden', 404, 'NOT_FOUND');
    }

    if (member.is_active === 0) {
      throw new AppError('Mitglied ist bereits deaktiviert', 409, 'ALREADY_INACTIVE');
    }

    this.members.deactivate(id);

    this.auditLog.create({
      event_type: 'member_deactivated',
      actor_id: actorId,
      target_type: 'member',
      target_id: id,
      meta: { username: member.username },
    });
  }

  // ---------------------------------------------------------------------------
  // Streichen / Entstreichen (Wirtschaftskommission bzw. Admin)
  // ---------------------------------------------------------------------------

  /**
   * Streicht ein Konto für die reguläre Dauer (2 Wochen ab jetzt). Solange die
   * Streichung gilt, können keine Getränke auf das Konto gebucht werden.
   * Erneutes Streichen setzt die Frist neu.
   */
  strike(id: number, actorId: number): MemberRow {
    const member = this.members.findById(id);
    if (!member) {
      throw new AppError('Mitglied nicht gefunden', 404, 'NOT_FOUND');
    }
    if (member.can_book_for_others === 1) {
      throw new AppError(
        'Theken-/Allgemein-Konten können nicht gestrichen werden',
        409,
        'NOT_STRIKEABLE',
      );
    }

    const until = new Date(Date.now() + STRIKE_DURATION_MS).toISOString();
    this.members.setStruckUntil(id, until);

    this.auditLog.create({
      event_type: 'member_struck',
      actor_id: actorId,
      target_type: 'member',
      target_id: id,
      meta: { username: member.username, struck_until: until },
    });

    return this.members.findById(id)!;
  }

  /**
   * Entstreicht ein Konto vorzeitig (setzt `struck_until` zurück). Ist das Konto
   * gar nicht (mehr) gestrichen, wird 409 `NOT_STRUCK` geworfen.
   */
  unstrike(id: number, actorId: number): MemberRow {
    const member = this.members.findById(id);
    if (!member) {
      throw new AppError('Mitglied nicht gefunden', 404, 'NOT_FOUND');
    }
    if (!isStruck(member)) {
      throw new AppError('Konto ist nicht gestrichen', 409, 'NOT_STRUCK');
    }

    this.members.setStruckUntil(id, null);

    this.auditLog.create({
      event_type: 'member_unstruck',
      actor_id: actorId,
      target_type: 'member',
      target_id: id,
      meta: { username: member.username },
    });

    return this.members.findById(id)!;
  }
}
