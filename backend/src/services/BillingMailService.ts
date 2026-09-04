import type { ReportService, MonthlyReport } from './ReportService.js';
import type { MembersRepo } from '../db/repos/MembersRepo.js';
import type { AuditLogRepo } from '../db/repos/AuditLogRepo.js';
import type { MailDispatchRepo } from '../db/repos/MailDispatchRepo.js';
import type { MailDispatchTrigger } from '../db/types.js';
import type { MailService } from './MailService.js';
import {
  generatePdf,
  generateAllMembersPdf,
  generateAllZeigerPdf,
} from '../formatters/pdfFormatter.js';
import { generateAllMembersCsv, generateAllZeigerCsv } from '../formatters/csvFormatter.js';

// ---------------------------------------------------------------------------
// BillingMailService — Kernlogik des automatischen Monatsabrechnungs-Versands
// (M15).
//
// Zwei Empfängerarten pro Lauf:
//  - "member":  eine Einzelabrechnung an jedes aktive Mitglied mit
//    hinterlegter E-Mail-Adresse UND Verbrauch > 0 im Monat.
//  - "summary": eine Sammelabrechnung (alle Mitglieder + alle Zeiger des
//    Monats, PDF + CSV) an die Wirtschaftskommission.
//
// Idempotent über `MailDispatchRepo.hasSent`: ein erneuter Lauf für denselben
// Monat verschickt nichts doppelt, versucht aber automatisch erneut, was beim
// letzten Mal fehlgeschlagen ist. Das macht sowohl den Scheduler-Catch-up
// nach einem Neustart als auch den "Erneut senden"-Button im Admin-UI zum
// selben simplen Aufruf: einfach nochmal `run()`.
// ---------------------------------------------------------------------------

export type RunLineStatus = 'sent' | 'failed' | 'skipped' | 'planned';

export interface RunLine {
  kind: 'member' | 'summary';
  memberId: number | null;
  displayName: string | null;
  recipient: string | null;
  status: RunLineStatus;
  reason?: string;
  totalCents?: number;
}

export interface RunOptions {
  triggeredBy: MailDispatchTrigger;
  /** true = nur berechnen, wer was bekäme — es wird nichts versendet oder gespeichert. */
  dryRun: boolean;
  /** Admin, der den manuellen Versand ausgelöst hat (für den Audit-Log). Bei triggeredBy "schedule" immer null. */
  actorId?: number | null;
}

export interface RunResult {
  /** Abrechnungsmonat im Format "YYYY-MM". */
  period: string;
  lines: RunLine[];
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

function eur(cents: number): string {
  return (cents / 100).toFixed(2).replace('.', ',') + ' €';
}

function monthLabel(year: number, month: number): string {
  return new Date(year, month - 1, 1).toLocaleString('de-DE', { month: 'long' });
}

function safeFileName(name: string): string {
  return name.replace(/[^a-z0-9äöüß]/gi, '_').toLowerCase();
}

/** Erster und letzter Kalendertag eines Monats (YYYY-MM-DD), für calculateAllZeiger. */
function monthDateRange(year: number, month: number): { from: string; to: string } {
  const pad = (n: number): string => String(n).padStart(2, '0');
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${year}-${pad(month)}-01`, to: `${year}-${pad(month)}-${pad(lastDay)}` };
}

function memberMailText(report: MonthlyReport, monthLbl: string, year: number): string {
  return [
    `Hallo ${report.member_display_name},`,
    '',
    `anbei deine Getränkeabrechnung für ${monthLbl} ${year}.`,
    '',
    `Gesamtbetrag: ${eur(report.grand_total_cents)}`,
    '',
    'Die Einzelbuchungen findest du im angehängten PDF.',
    '',
    'Bierwart',
    'Nassovia',
    '',
    '(Diese Mail wurde automatisch versendet.)',
  ].join('\n');
}

function summaryMailText(params: {
  monthLbl: string;
  year: number;
  memberCount: number;
  zeigerCount: number;
  grandTotalMembers: number;
  grandTotalZeiger: number;
}): string {
  return [
    'Liebe Wirtschaftskommission,',
    '',
    `anbei die Sammelabrechnung für ${params.monthLbl} ${params.year}.`,
    '',
    'Im Anhang:',
    '- Sammel-Abrechnung aller Mitglieder (PDF und CSV)',
    '- Zeiger-Übersicht des Monats (PDF und CSV)',
    '',
    `Mitglieder mit Buchungen: ${params.memberCount}`,
    `Zeiger im Zeitraum: ${params.zeigerCount}`,
    `Gesamtumsatz Mitglieder: ${eur(params.grandTotalMembers)}`,
    `Gesamtumsatz Zeiger: ${eur(params.grandTotalZeiger)}`,
    '',
    'Bierwart',
    'Nassovia',
    '',
    '(Diese Mail wurde automatisch versendet.)',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// BillingMailService
// ---------------------------------------------------------------------------

export class BillingMailService {
  constructor(
    private readonly reportService: ReportService,
    private readonly membersRepo: MembersRepo,
    private readonly mailService: MailService,
    private readonly mailDispatchRepo: MailDispatchRepo,
    private readonly auditLog: AuditLogRepo,
    private readonly summaryTo: string,
    private readonly summaryCc: string[],
  ) {}

  async run(year: number, month: number, opts: RunOptions): Promise<RunResult> {
    const period = `${year}-${String(month).padStart(2, '0')}`;
    const reports = this.reportService.calculateAllMembers(year, month);
    const emailById = new Map(this.membersRepo.findAll(false).map((m) => [m.id, m.email]));

    const lines: RunLine[] = [];
    for (const report of reports) {
      lines.push(await this.runMember(report, year, month, period, emailById, opts));
    }
    lines.push(await this.runSummary(reports, year, month, period, opts));

    return { period, lines };
  }

  private async runMember(
    report: MonthlyReport,
    year: number,
    month: number,
    period: string,
    emailById: Map<number, string | null>,
    opts: RunOptions,
  ): Promise<RunLine> {
    const email = emailById.get(report.member_id) ?? null;
    const base = {
      kind: 'member' as const,
      memberId: report.member_id,
      displayName: report.member_display_name,
      recipient: email,
      totalCents: report.grand_total_cents,
    };

    if (!email) {
      return { ...base, status: 'skipped', reason: 'Keine E-Mail-Adresse hinterlegt' };
    }
    if (report.grand_total_cents === 0) {
      return { ...base, status: 'skipped', reason: 'Kein Verbrauch in diesem Monat' };
    }
    if (this.mailDispatchRepo.hasSent(period, 'member', report.member_id)) {
      return { ...base, status: 'skipped', reason: 'Bereits versendet' };
    }
    if (opts.dryRun) {
      return { ...base, status: 'planned' };
    }

    const monthLbl = monthLabel(year, month);
    const monthStr = String(month).padStart(2, '0');
    const pdf = await generatePdf(report);
    const send = await this.mailService.send({
      to: email,
      subject: `Getränkeabrechnung ${monthLbl} ${year}`,
      text: memberMailText(report, monthLbl, year),
      attachments: [
        {
          filename: `abrechnung_${safeFileName(report.member_display_name)}_${year}-${monthStr}.pdf`,
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
    });

    const status: RunLineStatus = send.ok ? 'sent' : 'failed';
    this.mailDispatchRepo.create({
      period,
      kind: 'member',
      member_id: report.member_id,
      recipient: email,
      status,
      total_cents: report.grand_total_cents,
      error: send.ok ? null : (send.error ?? null),
      message_id: send.messageId ?? null,
      triggered_by: opts.triggeredBy,
    });
    this.auditLog.create({
      event_type: `mail_member_${status}`,
      actor_id: opts.actorId ?? null,
      target_type: 'member',
      target_id: report.member_id,
      meta: { period, recipient: email },
    });

    return { ...base, status, reason: send.ok ? undefined : send.error };
  }

  private async runSummary(
    reports: MonthlyReport[],
    year: number,
    month: number,
    period: string,
    opts: RunOptions,
  ): Promise<RunLine> {
    const base = {
      kind: 'summary' as const,
      memberId: null,
      displayName: null,
      recipient: this.summaryTo,
    };

    if (this.mailDispatchRepo.hasSent(period, 'summary', null)) {
      return { ...base, status: 'skipped', reason: 'Bereits versendet' };
    }
    if (opts.dryRun) {
      return { ...base, status: 'planned' };
    }

    const { from, to } = monthDateRange(year, month);
    const zeigerReports = this.reportService.calculateAllZeiger(from, to);
    const monthLbl = monthLabel(year, month);
    const monthStr = String(month).padStart(2, '0');
    const grandTotalMembers = reports.reduce((acc, r) => acc + r.grand_total_cents, 0);
    const grandTotalZeiger = zeigerReports.reduce((acc, z) => acc + z.grand_total_cents, 0);

    const [membersPdf, zeigerPdf] = await Promise.all([
      generateAllMembersPdf(reports),
      generateAllZeigerPdf(zeigerReports),
    ]);

    const send = await this.mailService.send({
      to: this.summaryTo,
      cc: this.summaryCc.length > 0 ? this.summaryCc : undefined,
      subject: `Sammelabrechnung ${monthLbl} ${year}`,
      text: summaryMailText({
        monthLbl,
        year,
        memberCount: reports.filter((r) => r.grand_total_cents > 0).length,
        zeigerCount: zeigerReports.length,
        grandTotalMembers,
        grandTotalZeiger,
      }),
      attachments: [
        {
          filename: `sammel_abrechnung_${year}-${monthStr}.pdf`,
          content: membersPdf,
          contentType: 'application/pdf',
        },
        {
          filename: `sammel_abrechnung_${year}-${monthStr}.csv`,
          content: generateAllMembersCsv(reports),
          contentType: 'text/csv',
        },
        {
          filename: `zeiger_uebersicht_${year}-${monthStr}.pdf`,
          content: zeigerPdf,
          contentType: 'application/pdf',
        },
        {
          filename: `zeiger_uebersicht_${year}-${monthStr}.csv`,
          content: generateAllZeigerCsv(zeigerReports),
          contentType: 'text/csv',
        },
      ],
    });

    const status: RunLineStatus = send.ok ? 'sent' : 'failed';
    this.mailDispatchRepo.create({
      period,
      kind: 'summary',
      member_id: null,
      recipient: this.summaryTo,
      status,
      total_cents: grandTotalMembers,
      error: send.ok ? null : (send.error ?? null),
      message_id: send.messageId ?? null,
      triggered_by: opts.triggeredBy,
    });
    this.auditLog.create({
      event_type: `mail_summary_${status}`,
      actor_id: opts.actorId ?? null,
      target_type: null,
      target_id: null,
      meta: { period, recipient: this.summaryTo, cc: this.summaryCc },
    });

    return {
      ...base,
      status,
      totalCents: grandTotalMembers,
      reason: send.ok ? undefined : send.error,
    };
  }

  /** Versandprotokoll für einen Monat (Format "YYYY-MM"), für das Admin-UI. */
  getLog(period: string) {
    return this.mailDispatchRepo.findByPeriod(period);
  }
}
