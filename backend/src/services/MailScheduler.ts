import type { Logger } from 'pino';
import { monthBounds } from './ReportService.js';
import type { BillingMailService } from './BillingMailService.js';

// ---------------------------------------------------------------------------
// MailScheduler — löst den automatischen Monatsabrechnungs-Versand aus (M15).
//
// Der Vereins-Pi läuft nicht zwingend 24/7. Statt eines einmaligen Cron-Slots
// prüft ein stündlicher Tick, ob der konfigurierte Termin (1. des Monats,
// MAIL_SCHEDULE_HOUR Uhr, Europe/Berlin) für den VORMONAT bereits erreicht
// ist — und zwar bewusst mit "erreicht oder überschritten", nicht "==".
// Das macht den Ausfall eines Pi über den Monatswechsel unschädlich: Beim
// nächsten Tick (spätestens beim nächsten Boot) wird sofort nachgeholt.
// BillingMailService.run() ist idempotent, ein wiederholter Tick am selben
// Tag verschickt also nichts doppelt.
//
// Deckt KEINEN Ausfall über mehr als einen Kalendermonat ab — dafür ist der
// manuelle Versand im Admin-UI gedacht (docs/MAIL.md).
// ---------------------------------------------------------------------------

/** Jahr/Monat des aktuellen Kalendertages in der Vereinszeitzone. */
function berlinYearMonth(instant: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(instant);
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  return { year, month };
}

/**
 * Ist der Versand-Termin für den Vormonat erreicht? Wenn ja, liefert
 * `{year, month}` des abzurechnenden (vorherigen) Monats zurück, sonst `null`.
 * Reine Funktion — direkt unit-testbar ohne Fake-Timer.
 */
export function computeDueBillingPeriod(
  now: Date,
  scheduleHour: number,
): { year: number; month: number } | null {
  const current = berlinYearMonth(now);
  const threshold = new Date(monthBounds(current.year, current.month).from);
  threshold.setUTCHours(threshold.getUTCHours() + scheduleHour);
  if (now.getTime() < threshold.getTime()) return null;

  const month = current.month === 1 ? 12 : current.month - 1;
  const year = current.month === 1 ? current.year - 1 : current.year;
  return { year, month };
}

export interface MailSchedulerOptions {
  /** Stunde (0–23, Europe/Berlin), ab der am 1. des Monats versendet wird. */
  hour: number;
  /** Prüfintervall in ms. Default: stündlich. */
  checkIntervalMs?: number;
}

export class MailScheduler {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly billingMailService: BillingMailService,
    private readonly opts: MailSchedulerOptions,
    private readonly logger: Logger,
  ) {}

  start(): void {
    if (this.timer) return;
    const interval = this.opts.checkIntervalMs ?? 60 * 60 * 1000;
    this.timer = setInterval(() => void this.tick(), interval);
    // unref(): der Timer darf den Prozess nicht am Beenden hindern
    // (z. B. beim SIGTERM-Shutdown in server.ts).
    this.timer.unref();
    // Sofort einmal prüfen — deckt den Fall ab, dass der Termin während
    // eines Ausfalls verstrichen ist (Catch-up nach Neustart).
    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(now: Date = new Date()): Promise<void> {
    const due = computeDueBillingPeriod(now, this.opts.hour);
    if (!due) return;

    try {
      const result = await this.billingMailService.run(due.year, due.month, {
        triggeredBy: 'schedule',
        dryRun: false,
        actorId: null,
      });
      this.logger.info(
        { year: due.year, month: due.month, lines: result.lines.length },
        'Automatischer Mailversand geprüft/ausgeführt',
      );
    } catch (err) {
      this.logger.error(
        { err, year: due.year, month: due.month },
        'Automatischer Mailversand fehlgeschlagen',
      );
    }
  }
}
