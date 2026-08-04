import { NavLink, Outlet } from 'react-router-dom';

function tabStyle(isActive: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    minHeight: 44,
    padding: '8px 16px',
    fontFamily: 'var(--font-sans)',
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textDecoration: 'none',
    color: isActive ? 'var(--korps-rot)' : 'var(--tinte-3)',
    borderBottom: isActive ? '2px solid var(--korps-rot)' : '2px solid transparent',
    background: 'none',
    transition: 'color 120ms, border-color 120ms',
    whiteSpace: 'nowrap',
  };
}

export default function AdminLayout() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      {/* Titel */}
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
          Verwaltung
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
          Mitglieder, Getränke und Buchungen pflegen
        </p>
      </div>

      {/* Tab-Navigation */}
      <nav
        aria-label="Verwaltungs-Navigation"
        style={{
          display: 'flex',
          gap: 0,
          borderBottom: '1px solid var(--line)',
          overflowX: 'auto',
          marginBottom: -24, // Kompensiert den gap, sodass der Inhalt direkt unter die Linie passt
        }}
      >
        <NavLink to="/admin/mitglieder" style={({ isActive }) => tabStyle(isActive)}>
          Mitglieder
        </NavLink>
        <NavLink to="/admin/getraenke" style={({ isActive }) => tabStyle(isActive)}>
          Getränke
        </NavLink>
        <NavLink to="/admin/kategorien" style={({ isActive }) => tabStyle(isActive)}>
          Kategorien
        </NavLink>
        <NavLink to="/admin/buchungen" style={({ isActive }) => tabStyle(isActive)}>
          Buchungen
        </NavLink>
        <NavLink to="/admin/berichte" style={({ isActive }) => tabStyle(isActive)}>
          Berichte
        </NavLink>
        <NavLink to="/admin/verbindungen" style={({ isActive }) => tabStyle(isActive)}>
          Verbindungen
        </NavLink>
        <NavLink to="/admin/system" style={({ isActive }) => tabStyle(isActive)}>
          System
        </NavLink>
      </nav>

      {/* Unter-Seite */}
      <div style={{ paddingTop: 8 }}>
        <Outlet />
      </div>
    </div>
  );
}
