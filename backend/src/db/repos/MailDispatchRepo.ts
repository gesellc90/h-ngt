import type { Db } from '../client.js';
import type {
  MailDispatchRow,
  MailDispatchKind,
  MailDispatchStatus,
  MailDispatchTrigger,
} from '../types.js';

export interface CreateMailDispatchInput {
  period: string;
  kind: MailDispatchKind;
  member_id: number | null;
  recipient: string;
  status: MailDispatchStatus;
  total_cents: number | null;
  error: string | null;
  message_id: string | null;
  triggered_by: MailDispatchTrigger;
}

export class MailDispatchRepo {
  constructor(private readonly db: Db) {}

  create(input: CreateMailDispatchInput): MailDispatchRow {
    const result = this.db
      .prepare(
        `INSERT INTO mail_dispatches
           (period, kind, member_id, recipient, status, total_cents, error, message_id, triggered_by)
         VALUES
           (@period, @kind, @member_id, @recipient, @status, @total_cents, @error, @message_id, @triggered_by)`,
      )
      .run(input);

    return this.db
      .prepare<[number | bigint], MailDispatchRow>('SELECT * FROM mail_dispatches WHERE id = ?')
      .get(result.lastInsertRowid)!;
  }

  /** Versandprotokoll für einen Abrechnungsmonat, älteste zuerst. */
  findByPeriod(period: string): MailDispatchRow[] {
    return this.db
      .prepare<
        [string],
        MailDispatchRow
      >('SELECT * FROM mail_dispatches WHERE period = ? ORDER BY created_at')
      .all(period);
  }

  /**
   * Wurde für diesen Monat/Empfänger bereits erfolgreich versendet?
   * Macht `BillingMailService.run` idempotent — ein Neustart oder ein
   * zweiter Klick auf "Jetzt versenden" verschickt nichts doppelt.
   */
  hasSent(period: string, kind: MailDispatchKind, memberId: number | null): boolean {
    const row =
      kind === 'member'
        ? this.db
            .prepare<[string, number], { c: number }>(
              `SELECT COUNT(*) AS c FROM mail_dispatches
               WHERE period = ? AND kind = 'member' AND member_id = ? AND status = 'sent'`,
            )
            .get(period, memberId as number)
        : this.db
            .prepare<[string], { c: number }>(
              `SELECT COUNT(*) AS c FROM mail_dispatches
               WHERE period = ? AND kind = 'summary' AND status = 'sent'`,
            )
            .get(period);

    return (row?.c ?? 0) > 0;
  }
}
