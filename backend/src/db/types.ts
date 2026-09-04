// ---------------------------------------------------------------------------
// DB-Row-Typen (spiegeln exakt die SQL-Schemas wider)
// ---------------------------------------------------------------------------

/** Korporationsstatus – unabhängig vom is_active-Login-/Soft-Delete-Flag. */
export type MemberStatus = 'aktiv' | 'inaktiv' | 'alter_herr' | 'freund';

export interface MemberRow {
  id: number;
  username: string;
  display_name: string;
  password_hash: string | null;
  role: 'admin' | 'member';
  is_active: 0 | 1;
  member_status: MemberStatus;
  can_book_for_others: 0 | 1;
  /** 1 = Konto der Wirtschaftskommission (darf Konten streichen/entstreichen). */
  is_wirtschaftskommission: 0 | 1;
  /**
   * ISO-8601-UTC-Zeitpunkt, bis zu dem das Konto gestrichen ist (keine
   * Personenbuchungen möglich). NULL = nicht gestrichen; ein Zeitpunkt in der
   * Vergangenheit gilt als abgelaufen (wieder bebuchbar).
   */
  struck_until: string | null;
  email: string | null;
  avatar_path: string | null;
  created_at: string;
  updated_at: string;
}

export interface DrinkCategoryRow {
  id: number;
  name: string;
  /** Anzeige-Reihenfolge (aufsteigend); bei Gleichstand entscheidet der Name. */
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface DrinkRow {
  id: number;
  name: string;
  is_available: 0 | 1;
  /** Pflichtzuordnung zur Kategorie (auf App-Ebene erzwungen, DB-Spalte nullable). */
  category_id: number;
  created_at: string;
  updated_at: string;
}

export interface DrinkPriceRow {
  id: number;
  drink_id: number;
  price_cents: number;
  valid_from: string;
  created_at: string;
}

export interface BookingRow {
  id: number;
  member_id: number;
  drink_id: number;
  price_cents_snapshot: number;
  booked_at: string;
  voided_at: string | null;
  void_reason: string | null;
  booked_by_id: number | null;
  /** NULL = Personenbuchung; gesetzt = Zeiger-Buchung (läuft auf Vereinskasse). */
  zeiger_id: number | null;
}

export interface VerbindungRow {
  id: number;
  name: string;
  zirkel: string | null;
  ort: string | null;
  active: 0 | 1;
  created_at: string;
}

export type ZeigerArt = 'veranstaltung' | 'besuch';
export type ZeigerStatus = 'offen' | 'geschlossen';

export interface ZeigerRow {
  id: number;
  titel: string;
  art: ZeigerArt;
  verbindung_id: number | null;
  created_by: number;
  anzahl_bundesbrueder: number;
  anzahl_gaeste: number;
  status: ZeigerStatus;
  opened_at: string;
  closed_at: string | null;
  closed_by: number | null;
}

export interface AuditLogRow {
  id: number;
  event_type: string;
  actor_id: number | null;
  target_type: string | null;
  target_id: number | null;
  meta: string | null; // JSON-String
  created_at: string;
}

export type MailDispatchKind = 'member' | 'summary';
export type MailDispatchStatus = 'sent' | 'failed';
export type MailDispatchTrigger = 'schedule' | 'manual';

export interface MailDispatchRow {
  id: number;
  /** Abrechnungsmonat im Format "YYYY-MM". */
  period: string;
  kind: MailDispatchKind;
  /** NULL bei kind = 'summary'. */
  member_id: number | null;
  recipient: string;
  status: MailDispatchStatus;
  total_cents: number | null;
  error: string | null;
  message_id: string | null;
  triggered_by: MailDispatchTrigger;
  created_at: string;
}
