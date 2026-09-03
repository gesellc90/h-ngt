import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { zeigerApi } from '../api/zeiger.js';
import { bookingsApi } from '../api/bookings.js';
import { drinksApi } from '../api/drinks.js';
import { verbindungenApi } from '../api/verbindungen.js';
import { ApiError } from '../api/client.js';
import { useAuth } from '../contexts/AuthContext.js';
import { useToast } from '../contexts/ToastContext.js';
import Spinner from '../components/Spinner.js';
import SectionTitle from '../components/SectionTitle.js';
import SortenButton, { formatCents } from '../components/SortenButton.js';
import { formatTime, isVoidable } from '../components/StrichHistory.js';
import type { ZeigerRow, BookingRow, DrinkWithCurrentPrice, VerbindungRow } from '../types/api.js';

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const btnGhost: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 36,
  padding: '4px 12px',
  borderRadius: 'var(--r-1)',
  border: '1px solid var(--line)',
  background: 'transparent',
  color: 'var(--tinte-3)',
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
};

const btnDanger: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  minHeight: 44,
  padding: '8px 20px',
  borderRadius: 'var(--r-2)',
  border: '1px solid var(--korps-rot)',
  background: 'transparent',
  color: 'var(--korps-rot)',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
};

// ---------------------------------------------------------------------------
// Buchungsliste
// ---------------------------------------------------------------------------

function ZeigerBuchungsListe({
  bookings,
  drinks,
  onVoid,
  voidingId,
  zeigerStatus,
}: {
  bookings: BookingRow[];
  drinks: DrinkWithCurrentPrice[];
  onVoid(id: number): void;
  voidingId: number | null;
  zeigerStatus: ZeigerRow['status'];
}) {
  const drinkMap = new Map(drinks.map((d) => [d.id, d]));
  const active = bookings.filter((b) => b.voided_at === null);
  const total = active.reduce((s, b) => s + b.price_cents_snapshot, 0);

  if (bookings.length === 0) {
    return (
      <p
        style={{
          padding: '16px 0',
          fontFamily: 'var(--font-serif)',
          fontStyle: 'italic',
          fontSize: 15,
          color: 'var(--tinte-4)',
        }}
      >
        Noch keine Striche auf diesem Zeiger.
      </p>
    );
  }

  return (
    <>
      {total > 0 && (
        <p
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 13,
            color: 'var(--tinte-3)',
            marginBottom: 8,
          }}
        >
          Gesamt (aktiv): <strong style={{ color: 'var(--tinte)' }}>{formatCents(total)}</strong>
        </p>
      )}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {bookings.map((b, i) => {
          const drink = drinkMap.get(b.drink_id);
          const voided = b.voided_at !== null;
          return (
            <li
              key={b.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '10px 0',
                borderTop: i > 0 ? '1px solid var(--line)' : 'none',
                opacity: voided ? 0.45 : 1,
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <p
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: 14,
                    fontWeight: 600,
                    color: 'var(--tinte)',
                    margin: 0,
                    textDecoration: voided ? 'line-through' : 'none',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {drink?.name ?? `Getränk #${b.drink_id}`}
                </p>
                <p
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: 12,
                    color: 'var(--tinte-4)',
                    margin: '2px 0 0',
                  }}
                >
                  {formatTime(b.booked_at)}
                  {voided && ' · storniert'}
                </p>
              </div>
              <span
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 14,
                  fontWeight: 600,
                  color: 'var(--tinte-2)',
                  flexShrink: 0,
                }}
              >
                {formatCents(b.price_cents_snapshot)}
              </span>
              {!voided && zeigerStatus === 'offen' && isVoidable(b) && (
                <button
                  onClick={() => onVoid(b.id)}
                  disabled={voidingId === b.id}
                  aria-label="Strich stornieren"
                  style={{
                    ...btnGhost,
                    border: '1px solid var(--korps-rot)',
                    color: 'var(--korps-rot)',
                    opacity: voidingId === b.id ? 0.5 : 1,
                    cursor: voidingId === b.id ? 'not-allowed' : 'pointer',
                  }}
                >
                  {voidingId === b.id ? <Spinner size="h-3 w-3" /> : 'Stornieren'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

// ---------------------------------------------------------------------------
// Hauptkomponente
// ---------------------------------------------------------------------------

export default function ZeigerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { member } = useAuth();
  const { showToast } = useToast();

  const [zeiger, setZeiger] = useState<ZeigerRow | null>(null);
  const [verbindung, setVerbindung] = useState<VerbindungRow | null>(null);
  const [drinks, setDrinks] = useState<DrinkWithCurrentPrice[]>([]);
  const [bookings, setBookings] = useState<BookingRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [bookingDrinkId, setBookingDrinkId] = useState<number | null>(null);
  const [voidingId, setVoidingId] = useState<number | null>(null);
  const [isClosing, setIsClosing] = useState(false);

  const zeigerId = Number(id);

  const loadBookings = useCallback(() => {
    zeigerApi
      .getBookings(zeigerId)
      .then(setBookings)
      .catch(() => {
        showToast('Buchungen konnten nicht geladen werden.', 'error');
      });
  }, [zeigerId, showToast]);

  useEffect(() => {
    Promise.all([zeigerApi.getById(zeigerId), drinksApi.getAvailable()])
      .then(([z, d]) => {
        setZeiger(z);
        setDrinks(d);
        if (z.verbindung_id !== null) {
          verbindungenApi.getAll(true).then((vs) => {
            setVerbindung(vs.find((v) => v.id === z.verbindung_id) ?? null);
          });
        }
      })
      .catch(() => showToast('Zeiger konnte nicht geladen werden.', 'error'))
      .finally(() => setIsLoading(false));
    loadBookings();
  }, [zeigerId, showToast, loadBookings]);

  // -- Buchen ---------------------------------------------------------------

  async function handleBook(drink: DrinkWithCurrentPrice) {
    if (bookingDrinkId !== null) return;
    const optimisticId = -Date.now();
    const optimistic: BookingRow = {
      id: optimisticId,
      member_id: member?.id ?? 0,
      drink_id: drink.id,
      price_cents_snapshot: drink.current_price_cents ?? 0,
      booked_at: new Date().toISOString(),
      voided_at: null,
      void_reason: null,
      booked_by_id: null,
    };
    setBookings((prev) => [optimistic, ...prev]);
    setBookingDrinkId(drink.id);
    try {
      const real = await bookingsApi.createForZeiger(drink.id, zeigerId);
      setBookings((prev) => prev.map((b) => (b.id === optimisticId ? real : b)));
      showToast(
        `${drink.name} auf Zeiger gebucht — ${formatCents(real.price_cents_snapshot)}`,
        'success',
      );
    } catch (err) {
      setBookings((prev) => prev.filter((b) => b.id !== optimisticId));
      const msg = err instanceof ApiError ? err.message : 'Buchung fehlgeschlagen.';
      showToast(msg, 'error');
    } finally {
      setBookingDrinkId(null);
    }
  }

  // -- Storno ---------------------------------------------------------------

  async function handleVoid(bookingId: number) {
    setVoidingId(bookingId);
    try {
      const updated = await bookingsApi.void(bookingId);
      setBookings((prev) => prev.map((b) => (b.id === bookingId ? updated : b)));
      showToast('Strich wurde storniert.', 'success');
    } catch {
      showToast('Stornierung fehlgeschlagen.', 'error');
    } finally {
      setVoidingId(null);
    }
  }

  // -- Schließen ------------------------------------------------------------

  async function handleClose() {
    if (!zeiger) return;
    setIsClosing(true);
    try {
      const closed = await zeigerApi.close(zeiger.id);
      setZeiger(closed);
      showToast(`Zeiger „${closed.titel}" wurde geschlossen.`, 'success');
    } catch {
      showToast('Schließen fehlgeschlagen.', 'error');
    } finally {
      setIsClosing(false);
    }
  }

  // -------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '48px 0' }}>
        <Spinner />
      </div>
    );
  }

  if (!zeiger) {
    return (
      <p style={{ fontFamily: 'var(--font-sans)', color: 'var(--tinte-3)' }}>
        Zeiger nicht gefunden.
      </p>
    );
  }

  // Jedes eingeloggte Mitglied darf einen offenen Zeiger schließen, nicht nur
  // Admin oder Ersteller — Backend (POST /zeiger/:id/close) erlaubt das
  // ohnehin schon jedem authentifizierten Mitglied.
  const canClose = zeiger.status === 'offen';
  const offen = zeiger.status === 'offen';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Zurück */}
      <button style={btnGhost} onClick={() => void navigate('/zeiger')}>
        ← Zurück zur Übersicht
      </button>

      {/* Zeiger-Kopf */}
      <div
        style={{
          padding: '16px 20px',
          borderRadius: 'var(--r-2)',
          border: `1px solid ${offen ? 'var(--korps-rot)' : 'var(--line)'}`,
          background: 'var(--bg-card)',
          display: 'flex',
          gap: 16,
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 20,
              fontWeight: 700,
              color: 'var(--tinte)',
              margin: 0,
            }}
          >
            {zeiger.titel}
          </h1>
          <p
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 13,
              color: 'var(--tinte-3)',
              margin: 0,
            }}
          >
            {zeiger.art === 'besuch' ? 'Couleurbesuch' : 'Veranstaltung'}
            {verbindung ? ` · ${verbindung.name}` : ''}
            {' · '}
            {new Date(zeiger.opened_at).toLocaleDateString('de-DE')}
          </p>
          {(zeiger.anzahl_bundesbrueder !== null || zeiger.anzahl_gaeste !== null) && (
            <p
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                color: 'var(--tinte-3)',
                margin: 0,
              }}
            >
              {zeiger.anzahl_bundesbrueder !== null
                ? `${zeiger.anzahl_bundesbrueder} Bundesbrüder`
                : ''}
              {zeiger.anzahl_bundesbrueder !== null && zeiger.anzahl_gaeste !== null ? ' · ' : ''}
              {zeiger.anzahl_gaeste !== null ? `${zeiger.anzahl_gaeste} Gäste` : ''}
            </p>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              fontFamily: 'var(--font-sans)',
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              padding: '3px 10px',
              borderRadius: 999,
              background: offen ? 'var(--korps-rot)' : 'var(--line)',
              color: offen ? 'var(--kreide)' : 'var(--tinte-3)',
            }}
          >
            {offen ? 'Offen' : 'Geschlossen'}
          </span>
          {canClose && (
            <button style={btnDanger} onClick={() => void handleClose()} disabled={isClosing}>
              {isClosing ? 'Schließen…' : 'Zeiger schließen'}
            </button>
          )}
        </div>
      </div>

      {/* Getränke buchen (nur bei offenem Zeiger) */}
      {offen && (
        <section aria-labelledby="buchen-heading">
          <SectionTitle>
            <span id="buchen-heading">Strich setzen</span>
          </SectionTitle>
          {drinks.length === 0 ? (
            <p
              style={{
                fontFamily: 'var(--font-serif)',
                fontStyle: 'italic',
                fontSize: 15,
                color: 'var(--tinte-4)',
              }}
            >
              Keine Getränke verfügbar.
            </p>
          ) : (
            <div
              style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}
              className="sm:grid-cols-3"
            >
              {drinks.map((drink) => (
                <SortenButton
                  key={drink.id}
                  name={drink.name}
                  priceCents={drink.current_price_cents ?? 0}
                  onClick={() => void handleBook(drink)}
                  disabled={bookingDrinkId !== null}
                  isLoading={bookingDrinkId === drink.id}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Buchungsliste */}
      <section aria-labelledby="liste-heading">
        <SectionTitle>
          <span id="liste-heading">Buchungen</span>
        </SectionTitle>
        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--r-3)',
            border: '1px solid var(--line)',
            padding: '0 16px',
            boxShadow: 'var(--sh-1)',
          }}
        >
          <ZeigerBuchungsListe
            bookings={bookings}
            drinks={drinks}
            onVoid={(id) => void handleVoid(id)}
            voidingId={voidingId}
            zeigerStatus={zeiger.status}
          />
        </div>
      </section>
    </div>
  );
}
