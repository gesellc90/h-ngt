import { useCallback, useEffect, useRef, useState } from 'react';
import { updateApi } from '../../api/update.js';
import { ApiError } from '../../api/client.js';
import { useToast } from '../../contexts/ToastContext.js';
import Spinner from '../../components/Spinner.js';
import SectionTitle from '../../components/SectionTitle.js';
import type { UpdateResult, UpdateStatus } from '../../types/api.js';

// ---------------------------------------------------------------------------
// System/Update-Seite (Admin) — M14.
//
// Zeigt den Status, den der Pi-lokale Auto-Update-Helper zuletzt in
// update-status.json geschrieben hat (siehe docs/AUTO-UPDATE.md), und
// erlaubt „Jetzt prüfen"/„Jetzt aktualisieren". Beide Buttons lösen kein
// Update direkt aus — sie schreiben nur eine Marker-Datei, die eine
// systemd-Path-Unit auf dem Pi beobachtet. Solange ein Lauf aktiv ist
// (`in_progress`), wird der Status alle paar Sekunden neu abgefragt.
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 4000;

const RESULT_LABEL: Record<UpdateResult, string> = {
  unknown: 'Noch kein Update-Lauf',
  up_to_date: 'Aktuell',
  update_available: 'Update verfügbar',
  in_progress: 'Update läuft…',
  success: 'Erfolgreich aktualisiert',
  failed: 'Fehlgeschlagen',
};

const TRIGGER_LABEL: Record<string, string> = {
  timer: 'automatisch (Zeitplan)',
  admin: 'manuell ausgelöst',
};

function badgeStyle(result: UpdateResult): React.CSSProperties {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '4px 10px',
    borderRadius: 999,
    fontFamily: 'var(--font-sans)',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.03em',
  };
  switch (result) {
    case 'update_available':
      return { ...base, background: 'var(--korps-rot)', color: '#fff' };
    case 'failed':
      return {
        ...base,
        background: 'transparent',
        color: 'var(--korps-rot)',
        border: '1px solid var(--korps-rot)',
      };
    case 'success':
    case 'up_to_date':
      return {
        ...base,
        background: 'var(--bg-2)',
        color: 'var(--tinte)',
        border: '1px solid var(--line)',
      };
    case 'in_progress':
      return { ...base, background: 'var(--messing)', color: 'var(--tinte)' };
    default:
      return {
        ...base,
        background: 'transparent',
        color: 'var(--tinte-3)',
        border: '1px solid var(--line)',
      };
  }
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

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

export default function SystemPage() {
  const { showToast } = useToast();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingAction, setPendingAction] = useState<'update' | 'check' | null>(null);
  const wasInProgress = useRef(false);

  const loadStatus = useCallback(async () => {
    try {
      const s = await updateApi.getStatus();
      setStatus(s);
      return s;
    } catch {
      showToast('Update-Status konnte nicht geladen werden.', 'error');
      return null;
    }
  }, [showToast]);

  useEffect(() => {
    void loadStatus().finally(() => setIsLoading(false));
  }, [loadStatus]);

  // Solange ein Lauf aktiv ist, alle paar Sekunden neu abfragen — beim
  // Wechsel von in_progress → abgeschlossen einmalig einen Toast zeigen.
  useEffect(() => {
    if (!status?.in_progress) return;
    wasInProgress.current = true;
    const timer = setInterval(() => {
      void loadStatus().then((s) => {
        if (s && !s.in_progress && wasInProgress.current) {
          wasInProgress.current = false;
          if (s.last_result === 'success') {
            showToast(
              `Update auf ${s.current_version ?? 'die neueste Version'} abgeschlossen.`,
              'success',
            );
          } else if (s.last_result === 'failed') {
            showToast(
              'Update fehlgeschlagen — die App läuft weiter auf dem vorherigen Stand.',
              'error',
            );
          }
        }
      });
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [status?.in_progress, loadStatus, showToast]);

  async function handleCheck() {
    setPendingAction('check');
    try {
      await updateApi.requestCheck();
      showToast('Prüfung angestoßen.', 'info');
      await loadStatus();
    } catch (err) {
      showToast(
        err instanceof ApiError && err.code === 'UPDATE_IN_PROGRESS'
          ? 'Es läuft bereits ein Update-Vorgang.'
          : err instanceof ApiError
            ? err.message
            : 'Prüfung konnte nicht angestoßen werden.',
        'error',
      );
    } finally {
      setPendingAction(null);
    }
  }

  async function handleUpdate() {
    if (
      !confirm(
        'Update jetzt installieren? Die App startet dabei kurz neu (wenige Sekunden Unterbrechung).',
      )
    ) {
      return;
    }
    setPendingAction('update');
    try {
      await updateApi.requestUpdate();
      showToast('Update angestoßen — die App startet in Kürze neu.', 'info');
      await loadStatus();
    } catch (err) {
      showToast(
        err instanceof ApiError && err.code === 'UPDATE_IN_PROGRESS'
          ? 'Es läuft bereits ein Update-Vorgang.'
          : err instanceof ApiError
            ? err.message
            : 'Update konnte nicht angestoßen werden.',
        'error',
      );
    } finally {
      setPendingAction(null);
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
          System
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
          Version & automatische Updates
        </p>
      </div>

      {isLoading || !status ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
          <Spinner size="h-10 w-10" />
        </div>
      ) : (
        <>
          <section>
            <SectionTitle>Update-Status</SectionTitle>
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                padding: 20,
                borderRadius: 'var(--r-3)',
                border: '1px solid var(--line)',
                borderTop: '3px solid var(--korps-rot)',
                background: 'var(--bg-card)',
                boxShadow: 'var(--sh-2)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={badgeStyle(status.last_result)}>
                  {status.in_progress ? <Spinner size="h-3 w-3" /> : null}
                  {RESULT_LABEL[status.last_result]}
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
                <dt style={{ color: 'var(--tinte-3)' }}>Laufende Version</dt>
                <dd style={{ margin: 0, color: 'var(--tinte)', fontWeight: 600 }}>
                  {status.current_version ?? 'unbekannt'}
                </dd>

                <dt style={{ color: 'var(--tinte-3)' }}>Verfügbare Version</dt>
                <dd style={{ margin: 0, color: 'var(--tinte)', fontWeight: 600 }}>
                  {status.available_version ?? '—'}
                </dd>

                <dt style={{ color: 'var(--tinte-3)' }}>Zuletzt geprüft</dt>
                <dd style={{ margin: 0, color: 'var(--tinte)' }}>
                  {formatDateTime(status.last_checked_at)}
                  {status.last_trigger && (
                    <span style={{ color: 'var(--tinte-4)' }}>
                      {' '}
                      ({TRIGGER_LABEL[status.last_trigger] ?? status.last_trigger})
                    </span>
                  )}
                </dd>
              </dl>

              <p
                style={{
                  fontFamily: 'var(--font-serif)',
                  fontStyle: 'italic',
                  fontSize: 13,
                  color: 'var(--tinte-4)',
                  margin: 0,
                }}
              >
                Automatisch alle zwei Wochen wird nach dem neuesten stabilen Release geprüft und —
                falls verfügbar — installiert. Beide Buttons lösen das gleiche geprüfte Verfahren
                aus (Backup, atomarer Wechsel, Neustart, automatischer Rollback bei Fehlern).
              </p>

              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button
                  style={{ ...btnGhost, opacity: pendingAction ? 0.6 : 1 }}
                  onClick={() => void handleCheck()}
                  disabled={pendingAction !== null || status.in_progress}
                >
                  {pendingAction === 'check' ? <Spinner size="h-4 w-4" /> : null}
                  Jetzt prüfen
                </button>
                <button
                  style={{ ...btnPrimary, opacity: pendingAction ? 0.6 : 1 }}
                  onClick={() => void handleUpdate()}
                  disabled={pendingAction !== null || status.in_progress}
                >
                  {pendingAction === 'update' ? <Spinner size="h-4 w-4" /> : null}
                  Jetzt aktualisieren
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
