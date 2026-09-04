/**
 * Admin-Seite: Automatischer Mailversand der Monatsabrechnungen (M15)
 *
 * Ablauf:
 *  - Status-Karte zeigt, ob der Versand aktiv ist und wohin die Sammelmail geht
 *  - Testmail prüft die SMTP-Verbindung, ohne eine Abrechnung zu versenden
 *  - Vorschau (Dry-Run) zeigt für einen Monat, wer was bekäme — ohne zu versenden
 *  - "Jetzt versenden" löst den echten Versand aus (idempotent: bereits
 *    versendete Empfänger werden übersprungen, fehlgeschlagene erneut versucht)
 *  - Versandprotokoll zeigt, was für den gewählten Monat bereits passiert ist
 */

import { useState, useCallback, useEffect } from 'react';
import { mailApi } from '../../api/mail.js';
import { ApiError } from '../../api/client.js';
import { useToast } from '../../contexts/ToastContext.js';
import SectionTitle from '../../components/SectionTitle.js';
import Spinner from '../../components/Spinner.js';
import type { MailStatus, MailRunResult, MailRunLine, MailDispatchRow } from '../../types/api.js';

// ---------------------------------------------------------------------------
// Hilfsfunktionen
// ---------------------------------------------------------------------------

function currentYearMonth(): { year: number; month: number } {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function yearRange(): number[] {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: 4 }, (_, i) => currentYear - 3 + i).reverse();
}

const MONTHS: { value: number; label: string }[] = Array.from({ length: 12 }, (_, i) => ({
  value: i + 1,
  label: new Date(2000, i, 1).toLocaleString('de-DE', { month: 'long' }),
}));

function eur(cents: number | undefined): string {
  if (cents === undefined) return '—';
  return (cents / 100).toFixed(2).replace('.', ',') + ' €';
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const cardStyle: React.CSSProperties = {
  borderRadius: 'var(--r-3)',
  border: '1px solid var(--line)',
  background: 'var(--bg-card)',
  padding: 24,
  boxShadow: 'var(--sh-1)',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontFamily: 'var(--font-sans)',
  fontSize: 11,
  fontWeight: 700,
  color: 'var(--tinte-3)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  marginBottom: 5,
};

const selectStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 44,
  padding: '8px 12px',
  borderRadius: 'var(--r-2)',
  border: '1px solid var(--line-2)',
  background: 'var(--bg)',
  color: 'var(--tinte)',
  fontFamily: 'var(--font-sans)',
  fontSize: 14,
};

const inputStyle: React.CSSProperties = { ...selectStyle };

const btnPrimary: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  minHeight: 44,
  padding: '8px 18px',
  borderRadius: 'var(--r-2)',
  border: 'none',
  background: 'var(--korps-rot)',
  color: 'var(--kreide)',
  fontFamily: 'var(--font-sans)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

const btnGhost: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  minHeight: 44,
  padding: '8px 18px',
  borderRadius: 'var(--r-2)',
  border: '1px solid var(--line-2)',
  background: 'transparent',
  color: 'var(--tinte)',
  fontFamily: 'var(--font-sans)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
};

function statusColor(status: MailRunLine['status'] | MailDispatchRow['status']): string {
  switch (status) {
    case 'sent':
      return 'var(--gruen, #16a34a)';
    case 'failed':
      return 'var(--korps-rot)';
    case 'planned':
      return 'var(--messing)';
    default:
      return 'var(--tinte-4)';
  }
}

const STATUS_LABEL: Record<string, string> = {
  sent: 'Versendet',
  failed: 'Fehlgeschlagen',
  skipped: 'Übersprungen',
  planned: 'Würde versendet',
};

function StatusBadge({ status }: { status: MailRunLine['status'] | MailDispatchRow['status'] }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 9px',
        borderRadius: 999,
        fontFamily: 'var(--font-sans)',
        fontSize: 12,
        fontWeight: 700,
        color: statusColor(status),
        border: `1px solid ${statusColor(status)}`,
      }}
    >
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Seite
// ---------------------------------------------------------------------------

export default function MailPage() {
  const { showToast } = useToast();
  const init = currentYearMonth();

  const [status, setStatus] = useState<MailStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);

  const [testTo, setTestTo] = useState('');
  const [testLoading, setTestLoading] = useState(false);

  const [year, setYear] = useState(init.year);
  const [month, setMonth] = useState(init.month);
  const [preview, setPreview] = useState<MailRunResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [dispatchLoading, setDispatchLoading] = useState(false);

  const [dispatches, setDispatches] = useState<MailDispatchRow[] | null>(null);
  const [dispatchesLoading, setDispatchesLoading] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await mailApi.getStatus());
    } catch {
      showToast('Mail-Status konnte nicht geladen werden.', 'error');
    } finally {
      setStatusLoading(false);
    }
  }, [showToast]);

  const loadDispatches = useCallback(async () => {
    setDispatchesLoading(true);
    try {
      setDispatches(await mailApi.getDispatches(year, month));
    } catch {
      showToast('Versandprotokoll konnte nicht geladen werden.', 'error');
    } finally {
      setDispatchesLoading(false);
    }
  }, [year, month, showToast]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    void loadDispatches();
    setPreview(null);
  }, [loadDispatches]);

  async function handleTest() {
    if (!testTo) return;
    setTestLoading(true);
    try {
      await mailApi.sendTest(testTo);
      showToast(`Testmail an ${testTo} versendet.`, 'success');
    } catch (err) {
      showToast(
        err instanceof ApiError && err.code === 'MAIL_DISABLED'
          ? 'Mailversand ist nicht aktiviert (MAIL_ENABLED=false).'
          : err instanceof ApiError
            ? err.message
            : 'Testmail fehlgeschlagen.',
        'error',
      );
    } finally {
      setTestLoading(false);
    }
  }

  async function handlePreview() {
    setPreviewLoading(true);
    try {
      setPreview(await mailApi.preview(year, month));
    } catch (err) {
      showToast(err instanceof ApiError ? err.message : 'Vorschau fehlgeschlagen.', 'error');
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleDispatch() {
    const sendable = preview?.lines.filter((l) => l.status === 'planned').length ?? null;
    const question =
      sendable !== null
        ? `Jetzt ${sendable} Mail(s) für ${MONTHS[month - 1]?.label} ${year} versenden?`
        : `Jetzt die Abrechnungen für ${MONTHS[month - 1]?.label} ${year} versenden?`;
    if (!confirm(question)) return;

    setDispatchLoading(true);
    try {
      const result = await mailApi.dispatch(year, month);
      const sent = result.lines.filter((l) => l.status === 'sent').length;
      const failed = result.lines.filter((l) => l.status === 'failed').length;
      showToast(
        failed > 0
          ? `${sent} Mail(s) versendet, ${failed} fehlgeschlagen.`
          : `${sent} Mail(s) versendet.`,
        failed > 0 ? 'error' : 'success',
      );
      setPreview(result);
      await loadDispatches();
    } catch (err) {
      showToast(
        err instanceof ApiError && err.code === 'MAIL_DISABLED'
          ? 'Mailversand ist nicht aktiviert (MAIL_ENABLED=false).'
          : err instanceof ApiError
            ? err.message
            : 'Versand fehlgeschlagen.',
        'error',
      );
    } finally {
      setDispatchLoading(false);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 20,
            fontWeight: 700,
            color: 'var(--tinte)',
            letterSpacing: '0.05em',
            margin: 0,
          }}
        >
          Mailversand
        </h1>
        <p
          style={{
            fontFamily: 'var(--font-serif)',
            fontStyle: 'italic',
            fontSize: 14,
            color: 'var(--tinte-3)',
            marginTop: 4,
            marginBottom: 0,
          }}
        >
          Automatischer Versand der Monatsabrechnungen
        </p>
      </div>

      {/* Status */}
      <section>
        <SectionTitle>Status</SectionTitle>
        <div style={cardStyle}>
          {statusLoading || !status ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
              <Spinner size="h-8 w-8" />
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
                <StatusBadge status={status.enabled ? 'sent' : 'skipped'} />
                <span
                  style={{ fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--tinte-3)' }}
                >
                  {status.enabled
                    ? 'Versand aktiviert'
                    : 'Versand deaktiviert (MAIL_ENABLED=false)'}
                </span>
              </div>
              <dl
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'max-content 1fr',
                  columnGap: 16,
                  rowGap: 8,
                  margin: 0,
                  fontFamily: 'var(--font-sans)',
                  fontSize: 14,
                }}
              >
                <dt style={{ color: 'var(--tinte-3)' }}>SMTP-Server</dt>
                <dd style={{ margin: 0, color: 'var(--tinte)' }}>
                  {status.smtpHost}:{status.smtpPort} {status.smtpSecure ? '(TLS)' : ''}
                </dd>
                <dt style={{ color: 'var(--tinte-3)' }}>Sammelabrechnung an</dt>
                <dd style={{ margin: 0, color: 'var(--tinte)' }}>
                  {status.summaryTo ?? '—'}
                  {status.summaryCc.length > 0 ? ` (CC: ${status.summaryCc.join(', ')})` : ''}
                </dd>
                <dt style={{ color: 'var(--tinte-3)' }}>Automatischer Versand</dt>
                <dd style={{ margin: 0, color: 'var(--tinte)' }}>
                  {status.scheduleEnabled
                    ? `Aktiv — 1. des Monats, ${status.scheduleHour}:00 Uhr`
                    : 'Deaktiviert (nur manueller Versand)'}
                </dd>
              </dl>

              <div
                style={{
                  display: 'flex',
                  gap: 10,
                  alignItems: 'flex-end',
                  flexWrap: 'wrap',
                  marginTop: 20,
                }}
              >
                <div style={{ flex: '1 1 240px' }}>
                  <label htmlFor="mail-test-to" style={labelStyle}>
                    Testmail an
                  </label>
                  <input
                    id="mail-test-to"
                    type="email"
                    placeholder="deine@adresse.de"
                    value={testTo}
                    onChange={(e) => setTestTo(e.target.value)}
                    style={inputStyle}
                  />
                </div>
                <button
                  style={{ ...btnGhost, opacity: testLoading || !testTo ? 0.6 : 1 }}
                  disabled={testLoading || !testTo}
                  onClick={() => void handleTest()}
                >
                  {testLoading ? <Spinner size="h-4 w-4" /> : null}
                  Testmail senden
                </button>
              </div>
            </>
          )}
        </div>
      </section>

      {/* Monatsauswahl + Vorschau/Versand */}
      <section>
        <SectionTitle>Monatsabrechnung</SectionTitle>
        <div style={cardStyle}>
          <div className="grid gap-4 sm:grid-cols-2" style={{ marginBottom: 20 }}>
            <div>
              <label htmlFor="mail-month" style={labelStyle}>
                Monat
              </label>
              <select
                id="mail-month"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                style={selectStyle}
              >
                {MONTHS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="mail-year" style={labelStyle}>
                Jahr
              </label>
              <select
                id="mail-year"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                style={selectStyle}
              >
                {yearRange().map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 20 }}>
            <button
              style={{ ...btnGhost, opacity: previewLoading ? 0.6 : 1 }}
              disabled={previewLoading}
              onClick={() => void handlePreview()}
            >
              {previewLoading ? <Spinner size="h-4 w-4" /> : null}
              Vorschau (Dry-Run)
            </button>
            <button
              style={{ ...btnPrimary, opacity: dispatchLoading || !status?.enabled ? 0.6 : 1 }}
              disabled={dispatchLoading || !status?.enabled}
              title={status?.enabled ? undefined : 'Mailversand ist nicht aktiviert'}
              onClick={() => void handleDispatch()}
            >
              {dispatchLoading ? <Spinner size="h-4 w-4" /> : null}
              Jetzt versenden
            </button>
          </div>

          {preview && (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--line)', textAlign: 'left' }}>
                    <th style={{ padding: '6px 10px' }}>Empfänger</th>
                    <th style={{ padding: '6px 10px' }}>E-Mail</th>
                    <th style={{ padding: '6px 10px', textAlign: 'right' }}>Betrag</th>
                    <th style={{ padding: '6px 10px' }}>Status</th>
                    <th style={{ padding: '6px 10px' }}>Grund</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.lines.map((line, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '6px 10px' }}>
                        {line.kind === 'summary' ? 'Sammelabrechnung (WK)' : line.displayName}
                      </td>
                      <td style={{ padding: '6px 10px', color: 'var(--tinte-3)' }}>
                        {line.recipient ?? '—'}
                      </td>
                      <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                        {eur(line.totalCents)}
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        <StatusBadge status={line.status} />
                      </td>
                      <td style={{ padding: '6px 10px', color: 'var(--tinte-3)' }}>
                        {line.reason ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {/* Versandprotokoll */}
      <section>
        <SectionTitle>Versandprotokoll</SectionTitle>
        <div style={cardStyle}>
          {dispatchesLoading ? (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '24px 0' }}>
              <Spinner size="h-8 w-8" />
            </div>
          ) : !dispatches || dispatches.length === 0 ? (
            <p
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 14,
                color: 'var(--tinte-3)',
                margin: 0,
              }}
            >
              Für {MONTHS[month - 1]?.label} {year} wurde noch nichts versendet.
            </p>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 13,
                }}
              >
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--line)', textAlign: 'left' }}>
                    <th style={{ padding: '6px 10px' }}>Zeitpunkt</th>
                    <th style={{ padding: '6px 10px' }}>Art</th>
                    <th style={{ padding: '6px 10px' }}>Empfänger</th>
                    <th style={{ padding: '6px 10px' }}>Status</th>
                    <th style={{ padding: '6px 10px' }}>Ausgelöst durch</th>
                    <th style={{ padding: '6px 10px' }}>Fehler</th>
                  </tr>
                </thead>
                <tbody>
                  {dispatches.map((d) => (
                    <tr key={d.id} style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={{ padding: '6px 10px', whiteSpace: 'nowrap' }}>
                        {formatDateTime(d.created_at)}
                      </td>
                      <td style={{ padding: '6px 10px' }}>
                        {d.kind === 'summary' ? 'Sammelabrechnung' : 'Mitglied'}
                      </td>
                      <td style={{ padding: '6px 10px' }}>{d.recipient}</td>
                      <td style={{ padding: '6px 10px' }}>
                        <StatusBadge status={d.status} />
                      </td>
                      <td style={{ padding: '6px 10px', color: 'var(--tinte-3)' }}>
                        {d.triggered_by === 'schedule' ? 'Automatisch' : 'Manuell'}
                      </td>
                      <td style={{ padding: '6px 10px', color: 'var(--korps-rot)' }}>
                        {d.error ?? ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {dispatches.some((d) => d.status === 'failed') && (
                <p
                  style={{
                    fontFamily: 'var(--font-serif)',
                    fontStyle: 'italic',
                    fontSize: 13,
                    color: 'var(--tinte-4)',
                    marginTop: 12,
                    marginBottom: 0,
                  }}
                >
                  Fehlgeschlagene Mails werden bei einem erneuten Klick auf „Jetzt versenden“
                  automatisch erneut versucht — bereits erfolgreich versendete werden dabei
                  übersprungen.
                </p>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
