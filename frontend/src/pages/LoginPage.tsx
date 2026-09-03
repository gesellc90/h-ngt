import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext.js';
import { ApiError } from '../api/client.js';
import Spinner from '../components/Spinner.js';
import Sigel from '../components/Sigel.js';

export default function LoginPage() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const from =
    (location.state as { from?: { pathname: string } } | null)?.from?.pathname ?? '/buchen';
  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setIsPending(true);

    try {
      await login(username.trim(), password);
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401) {
          setError('Benutzername oder Passwort nicht korrekt. Bitte prüfen und erneut versuchen.');
        } else if (err.status === 429) {
          setError('Zu viele Fehlversuche. Bitte warte 15 Minuten und versuche es erneut.');
        } else {
          setError(err.message);
        }
      } else {
        setError(
          'Verbindung zur Stube konnte nicht hergestellt werden. Bitte später erneut versuchen.',
        );
      }
    } finally {
      setIsPending(false);
    }
  }

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
        {/* ---------------------------------------------------------------- */}
        {/* Wordmark / Sigel                                                 */}
        {/* ---------------------------------------------------------------- */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          {/* Echtes Hängt!-Wappen-Sigel */}
          <div style={{ display: 'inline-block', marginBottom: 18 }}>
            <Sigel size={96} />
          </div>

          {/* Wortmarke: Cinzel uppercase, ! in Korps-Rot */}
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

          {/* Messing-Trennlinie + Tagline */}
          <div
            style={{
              width: 60,
              height: 1,
              background: 'var(--messing)',
              margin: '10px auto 8px',
            }}
          />
          <p
            style={{
              fontFamily: 'var(--font-serif)',
              fontStyle: 'italic',
              fontSize: 14,
              color: 'var(--tinte-3)',
              margin: 0,
              letterSpacing: '0.03em',
            }}
          >
            — Jeder Strich zählt —
          </p>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Formular-Karte                                                   */}
        {/* ---------------------------------------------------------------- */}
        <form
          onSubmit={(e) => void handleSubmit(e)}
          noValidate
          style={{
            background: 'var(--bg-card)',
            borderRadius: 'var(--r-3)',
            border: '1px solid var(--line)',
            padding: '28px 24px',
            boxShadow: 'var(--sh-2)',
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
            Einloggen
          </h2>

          {/* Fehlermeldung */}
          {error && (
            <div
              role="alert"
              style={{
                marginBottom: 16,
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
              {error}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Benutzername */}
            <div>
              <label
                htmlFor="username"
                style={{
                  display: 'block',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--tinte-2)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  marginBottom: 6,
                }}
              >
                Benutzername
              </label>
              <input
                id="username"
                type="text"
                autoComplete="username"
                required
                disabled={isPending}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="max.mustermann"
                style={{
                  width: '100%',
                  minHeight: 44,
                  padding: '10px 12px',
                  borderRadius: 'var(--r-2)',
                  border: '1px solid var(--line-2)',
                  background: 'var(--bg)',
                  color: 'var(--tinte)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 15,
                  outline: 'none',
                  boxSizing: 'border-box',
                  opacity: isPending ? 0.5 : 1,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--korps-rot)';
                  e.currentTarget.style.boxShadow = '0 0 0 2px rgba(122,28,42,0.15)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--line-2)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>

            {/* Passwort */}
            <div>
              <label
                htmlFor="password"
                style={{
                  display: 'block',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--tinte-2)',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  marginBottom: 6,
                }}
              >
                Passwort
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                disabled={isPending}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                style={{
                  width: '100%',
                  minHeight: 44,
                  padding: '10px 12px',
                  borderRadius: 'var(--r-2)',
                  border: '1px solid var(--line-2)',
                  background: 'var(--bg)',
                  color: 'var(--tinte)',
                  fontFamily: 'var(--font-sans)',
                  fontSize: 15,
                  outline: 'none',
                  boxSizing: 'border-box',
                  opacity: isPending ? 0.5 : 1,
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = 'var(--korps-rot)';
                  e.currentTarget.style.boxShadow = '0 0 0 2px rgba(122,28,42,0.15)';
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = 'var(--line-2)';
                  e.currentTarget.style.boxShadow = 'none';
                }}
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isPending || !username.trim() || !password}
              style={{
                minHeight: 48,
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                borderRadius: 'var(--r-2)',
                border: 'none',
                background:
                  isPending || !username.trim() || !password
                    ? 'var(--tinte-4)'
                    : 'var(--korps-rot)',
                color: 'var(--kreide)',
                fontFamily: 'var(--font-display)',
                fontSize: 15,
                fontWeight: 600,
                letterSpacing: '0.06em',
                cursor: isPending || !username.trim() || !password ? 'not-allowed' : 'pointer',
                transition: 'background 120ms',
                marginTop: 4,
              }}
            >
              {isPending ? (
                <>
                  <Spinner size="h-4 w-4" label="Wird eingeloggt…" />
                  Einloggen…
                </>
              ) : (
                'Einloggen'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
