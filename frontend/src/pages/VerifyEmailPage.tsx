import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { authApi } from '../api/auth.js';
import { ApiError } from '../api/client.js';
import Spinner from '../components/Spinner.js';
import Sigel from '../components/Sigel.js';

// ---------------------------------------------------------------------------
// Öffentliche Seite /verify-email?token=… (M16)
//
// Zeigt ein gestaltetes Ergebnis statt des rohen JSON der API — deshalb zeigt
// der Link in der Bestätigungsmail hierher und nicht direkt auf
// POST /auth/verify-email (siehe EmailVerificationService).
// ---------------------------------------------------------------------------

type Status = 'pending' | 'success' | 'error';

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'TOKEN_EXPIRED':
        return 'Dieser Bestätigungslink ist abgelaufen. Bitte fordere im Profil einen neuen an.';
      case 'TOKEN_USED':
        return 'Dieser Bestätigungslink wurde bereits verwendet.';
      case 'EMAIL_CHANGED':
        return 'Die E-Mail-Adresse wurde seitdem geändert. Bitte fordere im Profil einen neuen Bestätigungslink an.';
      case 'TOKEN_INVALID':
      default:
        return 'Dieser Bestätigungslink ist ungültig.';
    }
  }
  return 'Verbindung zur Stube konnte nicht hergestellt werden. Bitte später erneut versuchen.';
}

export default function VerifyEmailPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<Status>('pending');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      setMessage('Dieser Bestätigungslink ist ungültig.');
      return;
    }

    let cancelled = false;
    authApi
      .verifyEmail(token)
      .then(() => {
        if (cancelled) return;
        setStatus('success');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setStatus('error');
        setMessage(errorMessage(err));
      });

    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div
      style={{
        minHeight: '100svh',
        background: 'var(--bg)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 360 }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'inline-block', marginBottom: 18 }}>
            <Sigel size={96} />
          </div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 32,
              fontWeight: 700,
              color: 'var(--tinte)',
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              margin: 0,
              lineHeight: 1,
            }}
          >
            Hängt<span style={{ color: 'var(--korps-rot)' }}>!</span>
          </h1>
        </div>

        <div
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--r-3)',
            border: '1px solid var(--line)',
            padding: '28px 24px',
            boxShadow: 'var(--sh-2)',
            textAlign: 'center',
          }}
        >
          <h2
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 16,
              fontWeight: 600,
              color: 'var(--tinte)',
              letterSpacing: '0.04em',
              margin: '0 0 20px',
              paddingBottom: 10,
              borderBottom: '2px solid var(--korps-rot)',
              display: 'inline-block',
            }}
          >
            E-Mail-Bestätigung
          </h2>

          {status === 'pending' && (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '16px 0' }}>
              <Spinner size="h-8 w-8" label="Bestätigungslink wird geprüft…" />
            </div>
          )}

          {status === 'success' && (
            <p
              role="status"
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 14,
                lineHeight: 1.6,
                color: 'var(--tinte-2)',
                margin: 0,
              }}
            >
              Deine E-Mail-Adresse wurde erfolgreich bestätigt.
            </p>
          )}

          {status === 'error' && (
            <div
              role="alert"
              style={{
                padding: '10px 14px',
                borderRadius: 'var(--r-2)',
                border: '1px solid var(--fehler-bg)',
                background: 'var(--fehler-bg)',
                color: 'var(--fehler)',
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                lineHeight: 1.5,
              }}
            >
              {message}
            </div>
          )}

          {status !== 'pending' && (
            <Link
              to="/login"
              style={{
                display: 'inline-block',
                marginTop: 20,
                fontFamily: 'var(--font-sans)',
                fontSize: 13,
                fontWeight: 600,
                color: 'var(--korps-rot)',
                textDecoration: 'none',
              }}
            >
              Zum Login
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
