# Milestones

Dieser Plan unterteilt das Projekt in 10 aufeinander aufbauende Meilensteine. Jeder Meilenstein liefert einen demonstrierbaren Mehrwert und kann in 3–7 Tagen abgeschlossen werden.

| #   | Titel                                                    | Dauer (geschätzt) | Abhängigkeiten              |
| --- | -------------------------------------------------------- | ----------------- | --------------------------- |
| M1  | Projekt-Setup & Tooling                                  | 2–3 Tage          | —                           |
| M2  | Datenbankschicht & Migrationen                           | 2–3 Tage          | M1                          |
| M3  | Authentifizierung & Sicherheit                           | 3–4 Tage          | M2                          |
| M4  | API / Backend-Logik                                      | 5–7 Tage          | M3                          |
| M5  | Frontend (React)                                         | 5–7 Tage          | M4 (parallel ab M3 möglich) |
| M6  | Reporting & Export (PDF/CSV)                             | 3–4 Tage          | M4                          |
| M7  | CI/CD, Deployment & E2E-Tests                            | 3–4 Tage          | M5, M6                      |
| M8  | Design System — Hängt!-Marke                             | 3–5 Tage          | M5                          |
| M9  | Allgemein-Konto & Mitglieder-Kategorien                  | 3–5 Tage          | M4, M5                      |
| M10 | Erweitertes Mitglieder-Profil (Bild & E-Mail)            | 3–4 Tage          | M3, M5, M7                  |
| M11 | Zeiger (Couleurbesuch & Verbindungsveranst.)             | 4–6 Tage          | M4, M5, M9                  |
| M12 | Getränke-Kategorien & Verbrauchs-Auswertung              | 3–4 Tage          | M4, M5, M6                  |
| M13 | Wirtschaftskommission & Konten-Streichung                | 2–3 Tage          | M4, M5, M9                  |
| M14 | Automatisches App-Update (2-Wochen-Timer + Admin-Button) | 4–6 Tage          | M3, M5, M7                  |

---

## M1 — Projekt-Setup & Tooling

**Ziel:** Reproduzierbares Mono-Repo mit funktionierendem Dev-Loop für Backend und Frontend.

### Aufgaben

- [x] Repository initialisieren, `.gitignore`, `.editorconfig`
- [x] npm-Workspaces konfigurieren (`backend/`, `frontend/`)
- [x] Backend-Skeleton: Express, ESM, `pino`, Zod
- [x] Frontend-Skeleton: Vite + React + TailwindCSS + React Router
- [x] ESLint + Prettier (geteilte Config) + Husky + lint-staged
- [x] `npm run dev` startet Backend + Frontend parallel (z. B. via `concurrently`)
- [x] README-Grundgerüst, ARCHITECTURE-Skeleton, CHANGELOG, CONTRIBUTING
- [x] `engines`-Feld in `package.json` (Node ≥ 20)

**Definition of Done:** Frischer Klon → `npm install && npm run dev` startet beide Apps fehlerfrei. Lint läuft grün.

---

## M2 — Datenbankschicht & Migrationen

**Ziel:** Tippsicherer DB-Zugriff mit Migrationsmechanismus und Seed-Daten.

**Abhängigkeit:** M1.

### Aufgaben

- [x] `better-sqlite3` integrieren, WAL-Mode aktivieren
- [x] Migrations-Runner (selbstgebaut, < 100 LoC, oder `node-pg-migrate`-Light-Variante)
- [x] Migrationen 001–005: `members`, `drinks`, `drink_prices`, `bookings`, `audit_log`
- [x] Seed-Skript mit Demo-Daten (Admin, 2 Mitglieder, 4 Getränke, Preise)
- [x] Repository-Pattern: `MembersRepo`, `DrinksRepo`, `BookingsRepo`
- [x] Backup-Skript (`scripts/backup-db.sh`) + Doku
- [x] **Tests:** Unit-Tests für jedes Repo (in-memory SQLite via `:memory:`)

**Definition of Done:** `npm run db:migrate && npm run db:seed` legt eine konsistente DB an. Repos sind unit-getestet (≥ 80 % Coverage auf Repo-Layer).

---

## M3 — Authentifizierung & Sicherheit

**Ziel:** Funktionierender Login mit JWT, rollenbasierte Endpunkte, geschützte Routen.

**Abhängigkeit:** M2.

### Aufgaben

- [x] `bcrypt`-Password-Hashing (cost factor 10) — `bcryptjs` mit Timing-Safe-Dummy-Vergleich
- [x] `POST /auth/login` mit Zod-Validierung
- [x] JWT-Issuance (HS256, 8h), Secret aus ENV
- [x] `auth`-Middleware + `requireRole`-Middleware
- [x] `GET /auth/me`, `POST /auth/logout` (Token-Blocklist via SQLite, JTI-basiert)
- [x] Rate-Limit auf `/auth/login` (5 Versuche / 15 Min / IP)
- [x] Audit-Log-Einträge für Logins (Erfolg + Fehlschlag)
- [x] **Tests:** Supertest-Integrationstests für Login-Flow (happy path, falsches PW, gesperrter User, Rate-Limit)

**Definition of Done:** Mit Postman/curl: Login → Token erhalten → Token an geschützten Endpunkt schicken → 200. Falsches Token → 401.

---

## M4 — API / Backend-Logik

**Ziel:** Vollständige REST-API für Mitglieder, Getränke und Buchungen.

**Abhängigkeit:** M3.

### Aufgaben

- [x] `members`-Routen (CRUD, soft-delete)
- [x] `drinks`-Routen + Preisverwaltung (`drink_prices`-Historie)
- [x] `bookings`-Routen
  - [x] `POST /bookings` — Preis-Snapshot zur Buchungszeit
  - [x] `GET /bookings/me` mit Pagination (`?limit=50&before=<id>`)
  - [x] `POST /bookings/:id/void` mit 5-Minuten-Fenster-Logik
  - [x] `GET /bookings` (Admin) mit Filtern (Mitglied, Datum)
- [x] Globaler Error-Handler (Zod-Errors → 400, AuthErrors → 401, etc.)
- [x] OpenAPI-Spec (`docs/openapi.yaml`) generiert oder hand-gepflegt
- [x] **Tests:** Supertest-Integrationstests pro Endpoint, Service-Layer mit Vitest

**Definition of Done:** Alle in `ARCHITECTURE.md` dokumentierten Endpunkte funktionieren, sind validiert und integrationsgetestet.

---

## M5 — Frontend (React)

**Ziel:** Mobilfreundliche UI für Mitglieder und Admins.

**Abhängigkeit:** M4 (Login-Screen kann ab M3 parallel entwickelt werden).

### Aufgaben

- [x] API-Client mit Auth-Interceptor (Token aus `localStorage`)
- [x] `AuthContext` + `ProtectedRoute`-Komponente
- [x] **Login-Page** (Username + Passwort)
- [x] **Buchungsseite** (Hauptscreen):
  - [x] Große Buttons je Getränk, Tap = Buchung
  - [x] Optimistic Update + Toast bei Erfolg/Fehler
  - [x] Buchungshistorie der letzten 24h mit Storno-Button
- [x] **Profilseite** (eigene Buchungen, Monatssumme)
- [x] **Admin-Bereich** (eigene Route, nur für `role=admin`):
  - [x] Mitglieder-Tabelle (anlegen, deaktivieren, PW zurücksetzen)
  - [x] Getränke-Tabelle (anlegen, deaktivieren, Preis ändern)
  - [x] Buchungs-Übersicht mit Filtern
  - [x] Report-Download (Monat wählen, PDF/CSV)
- [x] Responsive Design (Tailwind-Breakpoints, Touch-Targets ≥ 44px)
- [ ] Dark-Mode (optional, `prefers-color-scheme`)
- [x] **Tests:** Vitest + React Testing Library für kritische Komponenten

**Definition of Done:** Vollständiger Klick-Pfad als Mitglied (Login → Buchen → Storno) und als Admin (Mitglied anlegen → Bericht herunterladen) funktioniert auf Mobile + Desktop.

---

## M6 — Reporting & Export (PDF/CSV)

**Ziel:** Monatsabrechnungen als PDF und CSV exportieren.

**Abhängigkeit:** M4.

### Aufgaben

- [x] `ReportService.calculateMonthly(memberId, year, month)` — aggregiert Buchungen, gruppiert nach Getränk
- [x] CSV-Export mit UTF-8-BOM (Excel-kompatibel), Spalten: Datum, Getränk, Anzahl, Einzelpreis, Gesamt
- [x] PDF-Export via PDFKit:
  - [x] Header mit Vereinsname + Logo (konfigurierbar)
  - [x] Tabelle mit Buchungen
  - [x] Summenzeile pro Getränk + Gesamtsumme
  - [x] Footer mit Erstellungsdatum
- [x] Endpunkt `GET /reports/monthly?...` mit `format`-Query (`pdf`|`csv`)
- [x] „Alle Mitglieder”-Sammel-PDF (Mehrseitig, Inhaltsverzeichnis)
- [x] **Tests:** Snapshot-Test auf CSV-Inhalt, Smoke-Test auf PDF-Größe + erstes Byte (`%PDF`)

**Definition of Done:** Admin lädt im UI eine Monatsabrechnung herunter, PDF öffnet korrekt, CSV importiert sauber in Excel/LibreOffice.

---

## M7 — CI/CD, Deployment & E2E-Tests

**Ziel:** Automatisches Build + Deploy auf den Raspberry Pi, abgesichert durch E2E-Tests.

**Abhängigkeit:** M5, M6.

### Aufgaben

- [x] GitHub Actions Workflow `ci.yml` (auf jedem PR + Push):
  - [x] Lint
  - [x] Unit-Tests
  - [x] Integrationstests
  - [x] Build-Artefakt erzeugen
- [x] GitHub Actions Workflow `deploy.yml` (auf Tag `v*`):
  - [x] Self-Hosted Runner auf dem Pi nimmt das Artefakt
  - [x] Backup der aktuellen DB
  - [x] Atomic Swap (`/opt/getraenke/current` → `releases/<tag>`)
  - [x] `systemctl restart getraenke.service`
  - [x] Smoke-Test (`curl /health`)
- [x] systemd-Unit-File (`scripts/getraenke.service`)
- [ ] Caddy/nginx als Reverse-Proxy mit lokalem TLS (optional)
- [x] Playwright-E2E-Suite:
  - [x] Login-Flow
  - [x] Buchung erstellen + sehen
  - [x] Storno innerhalb des Fensters
  - [x] Admin: Mitglied anlegen
  - [x] Admin: PDF-Report herunterladen (Header-Check)
- [x] Deployment-Doku in `docs/DEPLOYMENT.md`
- [x] Rollback-Prozedur dokumentiert

**Definition of Done:** Push eines Tags `v0.1.0` → Pipeline läuft grün → App ist live auf dem Pi → E2E-Smoke-Tests gegen die laufende Instanz sind grün.

---

## M8 — Design System — Hängt!-Marke

**Ziel:** Das bestehende Frontend konsequent auf das Hängt!-Design System umstellen — Pergament-Ästhetik, Verbindungs-Typografie, Marken-Tokens und passende Komponenten.

**Abhängigkeit:** M5.  
**Quelle:** `h-ngt-design-system/` — alle Tokens, Komponenten und Screens sind als HTML-Prototyp vorhanden. Vor der Implementierung `h-ngt-design-system/project/README.md` sowie `colors_and_type.css` und `ui_kits/app/index.html` vollständig lesen.

### Aufgaben

#### Design-Tokens & Basis

- [x] `colors_and_type.css` aus dem Design-Bundle als `frontend/src/styles/tokens.css` übernehmen (alle `--*`-Variablen: Farben, Typo, Spacing, Radien, Schatten)
- [x] Google Fonts laden: **Cinzel**, **Cormorant Garamond**, **Manrope**, **Caveat** (via `<link>` in `index.html`)
- [x] Tailwind-Config auf Design-Tokens ausrichten (`tailwind.config.ts`): `colors`, `fontFamily`, `borderRadius`, `boxShadow` aus den CSS-Variablen ableiten
- [x] Globales CSS-Reset: Hintergrund auf `--bg-pergament` (`#f4ead5`), Textfarbe auf `--tinte` (`#1a120b`), Browser-Blau-Focus-Outline deaktivieren → durch Korps-Rot-Outline ersetzen

#### Komponenten (nach Design-Prototyp)

- [x] **`WordmarkHeader`** — Eiche-Holz-Streifen (`--eiche`), Wortmarke in Cormorant Garamond links, Aktiver-Kürzel rechts; sticky top-0
- [x] **`SaldoCard`** — Große Saldo-Anzeige, Hintergrund `--bg-card` (`#fbf3df`), 3px Korps-Rot-Topstreifen, `--sh-2`
- [x] **`SortenButton`** (Tally-Kachel) — Stempelartige Kachel je Getränkesorte; Press-Animation `scale(.985)` 150ms `--ease-stempel`; Loading-State via Spinner
- [x] **`StrichRow`** — Listenzeile Aktiver + TallyStrokes-SVG + Saldo, 1px `--line`-Trenner
- [x] **`Stepper`** (−/+ Mengen-Stepper) — Pill-Shape, Korps-Rot-Buttons, scale(.92) bei Press
- [x] **`TabBar`** — Bottom-Nav Mobile, Icons via Lucide (22px, `currentColor`), aktiver Tab in `--messing`
- [x] Bestehende generische Komponenten (`Toast`, `Spinner`, `Layout`) auf Marken-Tokens umstellen

#### Screens & UX-Text

- [x] **Login-Screen** — Sigel-Logo mittig, Cerevis-Name/Verbindung-Label statt „Username", Button-Text „Einloggen", kein „Welcome back 👋"
- [x] **Buchungsseite (Stube)** — Layout nach `ui_kits/app/index.html`: Saldo oben, Sorten-Kacheln darunter, History-Liste
- [x] **Profilseite (Mein Buch)** — Verlauf + Monatsabschluss, Typografie in Cormorant Garamond für Zitate/Summenzeilen
- [x] **Admin-Bereich** — Tabellen mit Hairline-Trennern (`--line`), keine Bootstrap-artigen Grau-Hintergründe, Eyebrow-Section-Titles mit 2px Korps-Rot-Linie darunter
- [x] UX-Texte komplett nach Hängt!-Tonalität überarbeiten (kein Englisch-Deutsch-Mix, kein Emoji, „Du"-Ansprache, Verbindungsvokabular — Beispiele in `project/README.md` § „Konkrete Beispiele")

#### Qualitätssicherung

- [x] Touch-Targets ≥ 44px auf allen interaktiven Elementen (insb. `SortenButton`, `TabBar`) — `WordmarkHeader`-Avatar auf 44×44px angehoben
- [x] Focus-States: 2px Outline `--korps-rot`, 2px Offset, kein Browser-Default — `outline: none` aus Admin-Inputs + WordmarkHeader entfernt; globales `:focus-visible` greift
- [x] Kein `backdrop-filter`/Blur in der UI — grep bestätigt: keine Vorkommen
- [x] Keine Gradienten außer Sepia-Vignette auf Foto-Hero — grep bestätigt: keine unerlaubten Gradienten
- [x] **Tests:** Accessibility-Check auf Farbkontraste — Korps-Rot auf Pergament 8,67:1 ✓, alle kritischen Paare ≥ 4,5:1 (WCAG AA). Playwright-Screenshot-Tests: in laufender App manuell zu prüfen (CI-Sandbox kann keine headed Browser starten)

**Definition of Done:** Die App sieht aus wie der Prototyp in `ui_kits/app/index.html`. Pergament-Hintergrund überall, Eiche-Header, Korps-Rot-CTAs, Caveat-Striche. Kein Default-Tailwind-Blau, keine Emojis, kein englischer UI-Text.

---

## M9 — Allgemein-Konto (Theken-Modus) & Mitglieder-Kategorien

**Ziel:** Ein gemeinsames „Allgemein"-Konto, von dem aus am Tresen für beliebige Mitglieder gebucht werden kann, sowie eine Einteilung aller Mitglieder in vier Korporations-Kategorien für eine übersichtliche Auswahl.

**Abhängigkeit:** M4 (Booking-API), M5 (Frontend).

### Festgelegte Entscheidungen

- Das Allgemein-Konto ist ein **normales Mitglied mit Zusatz-Flag** `can_book_for_others` — es erbt alle Member-Rechte, darf aber zusätzlich für andere buchen. Keine neue Rolle (passt zu „sonst gleiche Rechte wie ein normaler Nutzer").
- Die vier Kategorien sind eine **eigene Dimension** (`member_status`), unabhängig vom bestehenden `is_active`-Login-/Soft-Delete-Flag. Dadurch bleiben auch Mitglieder ohne Login (z. B. „Freunde der Verbindung") bebuchbar.
- Im Theken-Modus wählt man ein Mitglied, setzt **beliebig viele Striche** (inkl. Storno) und kehrt erst per **„Fertig"-Button** zur Übersicht zurück.

### Datenbank & Backend

- [x] Migration 007: Spalte `member_status TEXT NOT NULL DEFAULT 'aktiv' CHECK (member_status IN ('aktiv','inaktiv','alter_herr','freund'))` an `members`
- [x] Migration 007: Spalte `can_book_for_others INTEGER NOT NULL DEFAULT 0 CHECK (can_book_for_others IN (0,1))` an `members`
- [x] Seed: „Allgemein"-Konto anlegen (`username='allgemein'`, `display_name='Allgemein'`, `role='member'`, `can_book_for_others=1`; Passwort wird von einem Admin gesetzt)
- [x] `MembersRepo`: neue Felder lesen/schreiben; `findBookable()` — alle bebuchbaren Mitglieder, gruppierbar nach `member_status` (Allgemein-Konto + Admins ausgenommen)
- [x] Zod-Schemas: `member_status` in Create-/Update-Member-Schema; `can_book_for_others` nur über Admin-Update setzbar
- [x] `POST /bookings` erweitern: optionales `member_id` im Body — wenn gesetzt, nur erlaubt wenn Requester `can_book_for_others=1` (sonst 403 `FORBIDDEN`); ohne `member_id` weiterhin Buchung für sich selbst
- [x] Buchungen eines bestimmten Mitglieds für den Theken-Screen ladbar machen (`GET /bookings/member/:id`; Allgemein-Konto darf fremde Buchungen lesen, beschränkt auf `member_id`-Filter)
- [x] `BookingService.void`: Konten mit `can_book_for_others` dürfen die von ihnen für andere angelegten Buchungen innerhalb des 5-Minuten-Fensters stornieren (über neue Spalte `booked_by_id`, Migration 008)
- [x] Audit-Log: `booking_created`/`booking_voided` halten `actor_id` (Allgemein-Konto) **und** Ziel-`member_id` fest („auf wen wurde gebucht")
- [x] **Tests:** Supertest — Buchen für anderes Mitglied als Allgemein-Konto (201), als normales Member (403), Lesen fremder Buchungen; Vitest — Repo-Felder, Service-Authz, Storno durch Allgemein-Konto

### Frontend

- [x] `AuthContext`/`GET /auth/me` liefern `can_book_for_others`
- [x] Routing: bei `can_book_for_others` rendert `/buchen` den **Theken-Flow** statt der normalen Stube; normale Mitglieder/Admins unverändert
- [x] **Mitglieder-Übersicht** (`MemberSelectView`): vier Abschnitte „Aktive", „Inaktive", „Alte Herren", „Freunde der Verbindung" mit Eyebrow-Section-Titles (Korps-Rot-Linie), große Touch-Kacheln je Mitglied (≥ 44px), Such-/Filterfeld
- [x] **Mitglieder-Buchungsansicht** (`MemberBookingView`): gewähltes Mitglied + Monats-Saldo oben, Sorten-Kacheln (Reuse `SortenButton`), Strich-Historie des Mitglieds mit Storno, prominenter **„Fertig"-Button** zurück zur Übersicht
- [x] `bookingsApi.createForMember(memberId, drinkId)` + `getForMember(memberId)`
- [x] `GET /members/bookable`: bebuchbare Mitglieder für Konten mit `can_book_for_others` (ohne Admin-Recht)
- [x] Admin `MembersPage`: Spalte/Editor für `member_status` (Dropdown), Toggle `can_book_for_others`
- [x] Konsistent mit Hängt!-Tokens (Pergament, Eiche-Header, Caveat-Striche) — kein neuer visueller Stil
- [x] **Tests:** Vitest + RTL — Gruppierung der Übersicht nach Kategorie, Flow Auswahl → Buchen → „Fertig" → zurück

### E2E & Doku

- [x] Playwright-E2E: Login als Allgemein-Konto → Mitglied aus Kategorie wählen → Strich setzen → Storno → „Fertig" → zurück zur Übersicht; Test-Seed um Allgemein-Konto + kategorisierte Mitglieder erweitert
- [x] `ARCHITECTURE.md`: neue Spalten, Endpunkt-Änderungen, Theken-Modus dokumentiert
- [x] `CHANGELOG.md`: nutzersichtbare Änderungen unter [Unreleased] gepflegt

**Definition of Done:** Login als „Allgemein" zeigt die nach vier Kategorien gruppierte Mitgliederübersicht. Auswahl eines Mitglieds → Striche setzen (mehrere möglich, Storno möglich) → „Fertig" → zurück zur Übersicht. Normale Mitglieder und Admins sehen unverändert ihre eigene Stube. Buchungen für andere sind im Audit-Log dem Allgemein-Konto zugeordnet. Lint, Unit-, Integrations- und E2E-Tests grün.

---

## M10 — Erweitertes Mitglieder-Profil (Profilbild & E-Mail)

**Ziel:** Das Mitglieder-Profil um ein **Profilbild** und eine **E-Mail-Adresse** erweitern. Beide Felder sind pflegbar — vom Mitglied selbst (Self-Service) und zusätzlich von Admins. Die E-Mail-Verifizierung ist bewusst **nicht** Teil von M10, sondern als eigener späterer Milestone vorgesehen (siehe Hinweis am Ende).

**Abhängigkeit:** M3 (Auth), M5 (Frontend), M7 (Deployment — StateDirectory für Bilddateien).

### Festgelegte Entscheidungen

- **Pflege durch Mitglied selbst + Admin.** Bisher gibt es keinen Self-Service — Mitglieder können nichts an sich ändern. M10 führt daher einen geschützten Self-Service-Endpunkt ein (`PATCH /auth/me`); Admins behalten den vollen Zugriff über `PATCH /members/:id`.
- **Profilbild im Dateisystem des Pi**, nicht als BLOB in SQLite. Dateien liegen unter dem `StateDirectory` (`/var/lib/getraenke/avatars/`), die DB hält nur den Pfad/Dateinamen. Auslieferung über eine statische Route. Vorteil: schlanke DB, effiziente Auslieferung; Backup muss den Ordner mitnehmen (Doku-Punkt).
- **E-Mail optional**, aber **eindeutig wenn gesetzt** (case-insensitive, `COLLATE NOCASE`) — damit eine spätere Verifizierung/Passwort-Reset-Funktion sauber daran anknüpfen kann.
- **Keine E-Mail-Verifizierung in M10.** Die Adresse wird nur gespeichert/gepflegt; ein „verifiziert"-Status kommt später (kein SMTP-Versand in diesem Milestone nötig).

### Datenbank & Backend

- [x] Migration 009: Spalte `email TEXT` an `members` (nullable, `COLLATE NOCASE`); partieller `UNIQUE`-Index nur für gesetzte Werte (`CREATE UNIQUE INDEX … WHERE email IS NOT NULL`)
- [x] Migration 009: Spalte `avatar_path TEXT` an `members` (nullable; relativer Dateiname im Avatar-Verzeichnis)
- [x] `MembersRepo`: `email`/`avatar_path` lesen/schreiben; `findByEmail()` für Eindeutigkeitsprüfung
- [x] Zod-Schemas: E-Mail-Format-Validierung (optional, trim, lowercase) im Create-/Update-Member-Schema **und** im neuen Self-Service-Schema
- [x] **Self-Service-Endpunkt** `PATCH /auth/me`: eingeloggtes Mitglied ändert eigene `email` (Konflikt → 409 `EMAIL_TAKEN`); Audit-Log-Eintrag
- [x] **Avatar-Upload** `POST /auth/me/avatar` (multipart, `multer`, 5 MB-Limit): Bild via `sharp` auf 256×256 WebP normalisieren, unter `AVATAR_DIR` speichern; `DELETE /auth/me/avatar` entfernt das Bild
- [x] Admin-Pendants: `PATCH /members/:id` akzeptiert zusätzlich `email`; Avatar-Verwaltung für beliebige Mitglieder (`POST/DELETE /members/:id/avatar`)
- [x] **Statische Auslieferung** der Avatare (`GET /avatars/:file` via `express.static`)
- [x] Konfiguration: ENV-Variable `AVATAR_DIR` (Dev: `./data/avatars`, Prod: `/var/lib/getraenke/avatars`)
- [x] **Tests:** Supertest — `PATCH /auth/me` (200, E-Mail-Konflikt 409, 400 leerer Body, 401), Avatar-Upload (200, 400 keine Datei, 401), Avatar-Delete (200, idempotent, 401); Vitest — Repo-Eindeutigkeit

### Frontend

- [x] `PublicMember`-Typ + API-Client um `email` und `avatar_path` erweitert; `apiUpload()` für Multipart
- [x] `ProfilePage`: E-Mail anzeigen und bearbeiten, Profilbild hochladen/entfernen, Avatar-Kreis mit Initialen-Fallback
- [x] Echtes Profilbild im `Layout`/`WordmarkHeader`
- [x] Admin `MembersPage`: E-Mail-Spalte/Editor
- [x] Konsistent mit Hängt!-Tokens — kein neuer visueller Stil

### E2E & Doku

- [x] Playwright-E2E `07-profil`: E-Mail setzen + in Karte sehen, Profilbild hochladen + Avatar erscheint, Konflikt-Toast bei doppelter E-Mail
- [x] `ARCHITECTURE.md`: neue Spalten (`email`, `avatar_path`), Self-Service-/Avatar-Endpunkte, Datei-Speicher-Entscheidung dokumentiert
- [x] `docs/DEPLOYMENT.md`: Avatar-Verzeichnis im `StateDirectory` + Backup-Hinweis
- [x] `CHANGELOG.md`: nutzersichtbare Änderungen unter [Unreleased] gepflegt

**Definition of Done:** Ein eingeloggtes Mitglied kann im Profil seine E-Mail-Adresse setzen/ändern und ein Profilbild hoch- und wieder abladen; das Bild erscheint im Header (Fallback: Initialen). Admins können dieselben Felder für beliebige Mitglieder pflegen. E-Mail-Adressen sind eindeutig. Bilddateien liegen im `StateDirectory` und überleben Deployments. Lint, Unit-, Integrations- und E2E-Tests grün.

> **Späterer Milestone — E-Mail-Verifizierung:** Setzt einen Versandweg voraus. Empfehlung für das Pi-Setup: **kein** Direktversand vom Pi (Deliverability/Spam), sondern ein externer SMTP-Relay/Transaktionsdienst — z. B. Brevo oder Mailgun (Free-Tier, SMTP) oder das Postfach des Vereinsproviders bzw. Gmail-SMTP mit App-Passwort. Technik dann: `nodemailer` + SMTP-Credentials in ENV, Spalte `email_verified_at`, einmaliger ablaufender Token (gehasht gespeichert), Bestätigungs-Endpunkt `GET /auth/verify-email?token=…` mit konfigurierter Basis-URL, Resend-Flow + Rate-Limit.

---

## M11 — Zeiger (Couleurbesuch & Verbindungsveranstaltungen)

**Ziel:** Gemeinsame Strichliste für Anlässe (Couleurbesuch, Kneipabend), auf die jedes Mitglied buchen kann. Die Kosten trägt die Vereins-/Veranstaltungskasse — Zeiger-Buchungen erscheinen _nicht_ im Personen-Saldo. Mehrere Zeiger können gleichzeitig offen sein.

**Abhängigkeit:** M4 (Buchungen), M5 (Frontend), M9 (Theken-Flow).

### Festgelegte Entscheidungen

- **Kostenträger:** Vereins-/Veranstaltungskasse. Zeiger-Buchungen (`bookings.zeiger_id IS NOT NULL`) zählen nicht zum Personen-Saldo.
- **Berechtigung:** Jedes Mitglied darf Zeiger öffnen und darauf buchen. Schließen: Ersteller oder Admin.
- **Verbindungen:** Admin-pflegbare Tabelle (`verbindungen`) als Schnellauswahl bei Couleurbesuchen; Freitext bleibt immer möglich (`titel`).
- **Abschluss:** Aggregierter Admin-Report über alle Zeiger (Zeitraum-Filter) als PDF/CSV, in den bestehenden `ReportService` integriert.
- **Storno:** Eigene Buchung im 5-Min-Fenster (solange Zeiger offen); Ersteller/Admin dürfen jede Buchung auf ihrem offenen Zeiger stornieren.

### PR 1 — Datenschicht

- [x] Migration 010: Tabellen `verbindungen` + `zeiger`; `bookings.zeiger_id` (nullable FK)
- [x] `VerbindungRow`, `ZeigerRow`, `ZeigerArt`, `ZeigerStatus` in `db/types.ts`
- [x] `VerbindungenRepo`: `findAll/findById/create/update/deactivate`
- [x] `ZeigerRepo`: `findAll(status?)/findById/create/update`
- [x] `BookingsRepo.create` um `zeiger_id` erweitert
- [x] Seed: 3 Beispiel-Verbindungen
- [x] Vitest: 16 Unit-Tests (VerbindungenRepo + ZeigerRepo)

### PR 2 — Zeiger-Lifecycle-Backend

- [x] `ZeigerService`: öffnen, abrufen, schließen (nur Ersteller/Admin), BBr/Gäste editieren
- [x] Routen: `POST /zeiger`, `GET /zeiger?status=`, `GET /zeiger/:id`, `PATCH /zeiger/:id`, `POST /zeiger/:id/close`
- [x] Audit-Log für öffnen + schließen
- [x] Supertest-Integrationstests (17 Tests)

### PR 3 — Buchen auf Zeiger

- [x] `POST /bookings` akzeptiert `zeiger_id`; Storno-Logik erweitern (Ersteller/Admin)
- [x] `GET /zeiger/:id/bookings`
- [x] Personen-Saldo/Reports auf `zeiger_id IS NULL` einschränken
- [x] 8 Supertest-Tests

### PR 4 — Verbindungen-Admin

- [x] CRUD-Backend: Routen `GET/POST/PATCH/DELETE /verbindungen` (Auth/Admin)
- [x] Admin-Frontend: neue Seite im Admin-Bereich (Tabelle + Inline-Edit + Anlegen)

### PR 5 — Frontend-Reiter „Zeiger"

- [x] Neuer Reiter in der Bottom-Nav + Route `/zeiger`
- [x] Liste offener Zeiger; Zeiger anlegen (Freitext oder Verbindungs-Schnellauswahl + BBr/Gäste)
- [x] Detail-/Buchungsansicht im Stil der `BookingPage` (Getränke buchen, Liste, Storno)
- [x] Schließen-Button (Ersteller/Admin); Ansicht geschlossener Zeiger

### PR 6 — Zeiger-Report, E2E & Doku

- [x] Aggregierter Report über alle Zeiger (Zeitraum-Filter) als PDF/CSV in `ReportService`
- [x] Admin-Frontend: Zeiger-Auswertungsbereich in `ReportPage` (Einzel + Übersicht)
- [x] Playwright-E2E: Zeiger öffnen → buchen → schließen; Konflikt-Prüfung (409)
- [x] `CHANGELOG.md`, `MILESTONES.md` aktualisiert

**Definition of Done:** Jedes Mitglied kann einen Zeiger (Couleurbesuch oder Veranstaltung) öffnen, Mitglieder buchen auf offene Zeiger, der Ersteller oder ein Admin schließt den Zeiger. Zeiger-Buchungen tauchen nicht im Personen-Saldo auf. Admins pflegen die Verbindungsliste und exportieren Zeiger-Auswertungen als PDF/CSV. Lint, Unit-, Integrations- und E2E-Tests grün.

---

## M12 — Getränke-Kategorien & Verbrauchs-Auswertung

**Ziel:** Getränke werden vom Admin einer Kategorie zugeordnet (Pflichtfeld) und in der Buchungsansicht nach Kategorie geclustert dargestellt. Der Admin bestimmt die Reihenfolge der Kategorien. Zusätzlich eine neue Admin-Auswertung: Getränkeverbrauch in einem frei wählbaren Zeitraum.

**Abhängigkeit:** M4 (Getränke/Buchungen), M5 (Frontend), M6 (Report-Export).

### Festgelegte Entscheidungen

- **Bestandsdaten:** Migration legt die Standardkategorie „Sonstige" an und ordnet alle bestehenden Getränke ihr zu. Die Kategorie ist auf App-Ebene ein Pflichtfeld; die DB-Spalte bleibt technisch nullable (SQLite-`ALTER TABLE`-Restriktion), enthält durch Backfill + Service-Validierung aber nie NULL.
- **Löschschutz:** Eine Kategorie lässt sich nur löschen, wenn ihr keine Getränke mehr zugeordnet sind (FK `ON DELETE RESTRICT` + Service-Prüfung → 409 `CATEGORY_NOT_EMPTY`).
- **Reihenfolge:** Admin-pflegbar über `sort_order`; die Buchungs-/Theken-Ansicht clustert Getränke in genau dieser Reihenfolge.
- **Verbrauchs-Auswertung:** Anzahl **und** Umsatz je Getränk, nach Kategorie gruppiert, mit Zwischen- und Gesamtsummen. Berücksichtigt **alle** nicht-stornierten Buchungen (Personen- und Zeiger-Buchungen) im gewählten Zeitraum. Export als PDF und CSV, integriert in den bestehenden `ReportService`.

### PR 1 — Datenschicht

- [x] Migration 011: Tabelle `drink_categories` (STRICT), Standardkategorie „Sonstige", `drinks.category_id` (FK `ON DELETE RESTRICT`), Bestand-Backfill, Index
- [x] `DrinkCategoryRow`, `DrinkRow.category_id` in `db/types.ts`
- [x] `DrinkCategoriesRepo`: `findAll`/`findById`/`findByName`/`create`/`update`/`delete`/`reorder`/`countDrinks`
- [x] `DrinksRepo` um `category_id` erweitert (create/update, Listen mit Kategorie-Join)
- [x] `BookingsRepo.findConsumption(from, to)` mit Kategorie-Join
- [x] Seed: Demo-Kategorien + Zuordnung der Seed-Getränke
- [x] Vitest: `DrinkCategoriesRepo`-Unit-Tests

### PR 2 — Kategorie-Backend & Drinks-Anpassung

- [x] `DrinkCategoriesService` mit Audit-Log + Löschschutz
- [x] `DrinksService`: Pflicht-Kategorie beim Anlegen (validiert), Kategorie-Änderung
- [x] Schemas + Routen `GET /drink-categories`, `POST/PATCH/DELETE /drink-categories/:id`, `PUT /drink-categories/order`; `drinks`-Schema um `category_id`
- [x] `app.ts` verdrahtet Repo, Service und Router
- [x] Supertest-Integrationstests (Kategorie-CRUD, Reorder, Löschschutz)

### PR 3 — Verbrauchs-Auswertung

- [x] `ReportService.calculateConsumption` (nach Kategorie gruppiert, Anzahl + Umsatz)
- [x] CSV- und PDF-Formatter für die Verbrauchs-Auswertung
- [x] Route `GET /reports/consumption?from&to&format` (Admin)
- [x] Unit- und Integrationstests (Aggregation, Zeitraumgrenzen, CSV/PDF, 400/403)

### PR 4 — Frontend

- [x] Admin-Reiter „Kategorien" (`CategoriesPage`): Anlegen, Umbenennen, Löschen, Reihenfolge (Hoch/Runter)
- [x] `DrinksPage`: Kategorie-Pflichtfeld beim Anlegen, Kategorie-Spalte zum Umhängen
- [x] Buchungs- und Theken-Ansicht clustern Getränke nach Kategorie (Admin-Reihenfolge)
- [x] `ReportPage`: Verbrauchs-Auswertung mit frei wählbarem Zeitraum (CSV/PDF)
- [x] Route + Navigations-Tab, API-Module (`drinkCategories`, erweitertes `drinks`/`reports`)

### PR 5 — Doku

- [x] `CHANGELOG.md` (Unreleased) und `MILESTONES.md` aktualisiert
- [x] README-Feature-Liste ergänzt

**Definition of Done:** Ein Admin pflegt Kategorien inkl. Reihenfolge, jedes neue Getränk muss einer Kategorie zugeordnet werden, und die Buchungsansicht zeigt Getränke nach Kategorie geclustert in der Admin-Reihenfolge. Kategorien mit zugeordneten Getränken lassen sich nicht löschen. Der Admin exportiert den Getränkeverbrauch (Anzahl + Umsatz, nach Kategorie) für einen frei wählbaren Zeitraum als PDF/CSV. Lint, Unit- und Integrationstests grün.

---

## M13 — Wirtschaftskommission & Konten-Streichung

**Ziel:** Eine neue Konto-Variante „Wirtschaftskommission" (WK) kann Mitglieder-Konten streichen. Ein gestrichenes Konto kann für 2 Wochen keine Getränke gebucht bekommen; alle übrigen Funktionen bleiben verfügbar. Gestrichene Konten erscheinen ausgeblichen in der Auswahl. Die WK kann Konten auch vorzeitig entstreichen.

**Abhängigkeit:** M4 (Mitglieder/Buchungen), M5 (Frontend), M9 (Kategorien/Theken-Konto).

### Festgelegte Entscheidungen

- **WK als Capability-Flag statt neuer Rolle:** `is_wirtschaftskommission` an `members` (analog `can_book_for_others`). Ein Rebuild der `members`-Tabelle zum Erweitern der `role`-CHECK-Constraint wäre wegen der `ON DELETE RESTRICT`-Fremdschlüssel (`bookings.member_id`, `zeiger.created_by`) im Migrations-Runner nicht gefahrlos möglich. Der WK-Bereich ist bewusst schlank: kein Zugriff auf die übrige Admin-Verwaltung.
- **Wer darf streichen:** WK **und** Admin (Admin bleibt Superset). Umgesetzt über die Middleware `requireWkOrAdmin`; das JWT-Payload trägt `is_wk` (frisch aus der DB, wie die Rolle).
- **Streich-Modell:** `struck_until` (nullable ISO-Zeitstempel). Streichen setzt jetzt + 14 Tage; ein Zeitpunkt in der Vergangenheit gilt als abgelaufen (automatisch wieder bebuchbar) — kein Cron nötig. Entstreichen setzt `struck_until` zurück.
- **Buchsperre:** Nur Personenbuchungen auf gestrichene Konten werden blockiert (→ 409 `MEMBER_STRUCK`), betrifft Selbst- und Theken-Buchungen. Zeiger-Buchungen laufen auf die Vereinskasse und bleiben erlaubt.
- **Darstellung:** Gestrichene Konten stehen ausgeblichen/durchgestrichen und nicht anwählbar in der Theken-Auswahl („gestrichen bis <Datum>"); in der eigenen Stube werden die Getränke-Buttons gesperrt und ein Hinweis eingeblendet.

### PR 1 — Datenschicht & Backend

- [x] Migration 012: `members.is_wirtschaftskommission` (Flag) und `members.struck_until` (nullable)
- [x] `MemberRow`-Typ, `MembersRepo` (create/update um WK-Flag, `setStruckUntil`)
- [x] `MembersService.strike`/`unstrike`/`findStrikeable` + Audit-Log; `BookingService` blockiert Buchungen auf gestrichene Konten
- [x] `AuthService`: `is_wk` im JWT-Payload (frisch aus der DB); Middleware `requireWkOrAdmin`
- [x] Routen `POST /members/:id/strike`, `POST /members/:id/unstrike`, `GET /members/strikeable`; Schemas um `is_wirtschaftskommission`
- [x] Seed: Demo-WK-Konto `wiko` (Dev-Passwort `wiko123`)
- [x] Unit- (MembersRepo) und Integrationstests (Streichen/Entstreichen, Rechte, Buchsperre, Zeiger-Ausnahme)

### PR 2 — Frontend

- [x] Neue Seite „Streichen" (`/wk`) für WK und Admin: Kontenliste nach Kategorie, Streichen (Bestätigung) und Entstreichen
- [x] `AuthContext` (`isWk`/`canStrike`), `ProtectedRoute` (`role="wk"`), Navigations-Eintrag „Streichen"
- [x] Theken-Auswahl: gestrichene Konten ausgeblichen + nicht anwählbar; `BookingPage`: Hinweisbanner + gesperrte Buttons
- [x] Admin-Mitgliederverwaltung: WK-Spalte/Checkbox + WK-Feld im Anlegen-Formular; `members`-API-Modul erweitert
- [x] Vitest-Komponententests (`StreichenPage`, gestrichenes Konto in `ThekePage`)

### PR 3 — Doku

- [x] `CHANGELOG.md`, `MILESTONES.md`, `ARCHITECTURE.md`, `README.md` aktualisiert

**Definition of Done:** Ein WK-Konto (und Admins) kann Mitglieder-Konten streichen und vorzeitig entstreichen. Auf ein gestrichenes Konto können 2 Wochen lang keine Getränke gebucht werden (Selbst- und Theken-Buchung), Zeiger-Buchungen bleiben möglich; nach Ablauf ist das Konto automatisch wieder bebuchbar. Gestrichene Konten erscheinen ausgeblichen in der Theken-Auswahl. Lint, Unit-, Integrations- und Komponententests grün.

---

## M14 — Automatisches App-Update (2-Wochen-Timer + Admin-Button)

**Ziel:** Der Pi aktualisiert die App **alle zwei Wochen automatisch** auf das neueste stabile Release, ohne dass jemand einen Tag pusht oder sich per SSH anmeldet. Zusätzlich kann ein **Admin das Update jederzeit händisch anstoßen** und im Admin-Bereich sehen, welche Version läuft, ob eine neuere verfügbar ist und wie das letzte Update ausgegangen ist. Das Update ist so abgesichert wie der bestehende Tag-Deploy (DB-Backup, atomarer Symlink-Swap, Smoke-Test, automatischer Rollback).

**Abhängigkeit:** M3 (Admin-Auth), M5 (Frontend/Admin-Bereich), M7 (Deploy-Pipeline, Release-Tarball, systemd-Service).

### Festgelegte Entscheidungen

- **Umfang: nur die App.** Aktualisiert werden Frontend + Backend. Betriebssystem-/`apt`-Updates des Pi bleiben bewusst außen vor (separate Pflege) — das hält den privilegierten Anteil klein und den Rollback berechenbar.
- **Ziel: nur stabile Release-Tags.** Automatisch installiert wird ausschließlich das neueste `vX.Y.Z`-Release, das die Pipeline grün durchlaufen hat — nie ein ungetesteter `main`-Zwischenstand. Downgrades/Pinning sind über den automatischen Weg nicht möglich (Helper zielt immer auf „latest stable").
- **Mechanismus: Pi-lokal, kein Cloud-Abruf durch die App.** Ein systemd-**Timer** (`getraenke-update.timer`) startet alle zwei Wochen einen **oneshot-Update-Service** (`getraenke-update.service`), der `scripts/pi-self-update.sh` ausführt. Nur dieser Helper spricht mit GitHub (Release-Abfrage + Tarball-Download). Die App selbst macht zur Laufzeit **keinen** ausgehenden Request — passt zum Grundsatz „keine Cloud, keine externen Laufzeit-Abhängigkeiten".
- **Privilege-Separation für den Admin-Button.** Der `getraenke`-Service läuft weiter gehärtet und unprivilegiert (`NoNewPrivileges`, `ProtectSystem=strict`, kein sudo). Der Admin-Button **triggert das Update nicht selbst**, sondern legt nur eine **Marker-Datei** in das ohnehin beschreibbare `StateDirectory` (`/var/lib/getraenke/`). Eine system-seitige **`getraenke-update.path`-Unit** beobachtet diese Datei und startet den privilegierten Update-Service. So braucht die App **keinerlei** sudo-Rechte und kann kein beliebiges Kommando/keine beliebige Zielversion einschleusen — der Marker ist ein reines Signal, das Ziel („latest stable") bestimmt allein der Helper.
- **Status-Rückkanal über Datei, nicht über GitHub.** Der Helper schreibt nach jedem Lauf `/var/lib/getraenke/update-status.json` (aktuelle Version, zuletzt bekannte verfügbare Version, Zeitpunkt der letzten Prüfung, Ergebnis des letzten Updates, `in_progress`-Flag). Der Admin-Bereich liest **nur diese Datei** — dadurch kennt die App die verfügbare Version, ohne selbst online zu gehen.
- **Gemeinsame Pi-Release-Logik.** Die Pi-seitigen Deploy-Schritte (Tarball entpacken → `npm ci --omit=dev` → Migrationen → atomarer Swap → Restart → Smoke-Test → Rollback → Alt-Releases aufräumen) werden aus `deploy.yml` in ein wiederverwendbares Skript `scripts/pi-release.sh` gezogen. `deploy.yml` **und** `pi-self-update.sh` rufen dasselbe Skript auf — ein Update-Pfad, ein Rollback-Verhalten, kein Drift.
- **Release-Tarball als GitHub-Release-Asset.** Damit der Pi „das neueste Release" ziehen kann, hängt `deploy.yml` den Build-Tarball zusätzlich als **Release-Asset** an das Tag (bisher nur flüchtiges Actions-Artefakt, 30 Tage). Da das Repo privat ist, liegt ein **read-only Fine-Grained-Token** (nur `contents:read`) auf dem Pi unter `/etc/getraenke/update.env` — nicht im App-Prozess, nur für den Helper lesbar.
- **Zeitplan.** `OnCalendar=Mon *-*-01..07,15..21 03:30` (grob zweiwöchentlich, in der Nacht) mit `Persistent=true`, damit ein verpasster Lauf (Pi war aus) beim nächsten Start nachgeholt wird. Intervall/Uhrzeit sind in der Timer-Unit konfigurierbar.

### PR 1 — Pi-Release-Logik extrahieren & Release-Asset

- [x] `scripts/pi-release.sh` anlegen: nimmt `<tarball> <tag>`, führt Backup → Entpacken → `npm ci --omit=dev` → `deploy-migrate.sh` → atomarer Symlink-Swap → `systemctl restart` → Smoke-Test (`/api/v1/health`) → Rollback bei Fehler → Aufräumen (letzte 5 Releases) aus. Idempotent, `set -euo pipefail`, aussagekräftige Logs.
- [x] `deploy.yml` refactoren: der Pi-`deploy`-Job ruft `pi-release.sh` statt der inline-Steps auf (Verhalten unverändert, nur zentralisiert). Tarball-Inhalt um `scripts/pi-release.sh` erweitert.
- [x] `deploy.yml`: Schritt „GitHub-Release anlegen/aktualisieren + Tarball als Asset anhängen" (`softprops/action-gh-release`, für das gepushte Tag).
- [x] **Tests:** `shellcheck` über `scripts/pi-release.sh` (in `ci.yml` eingehängt, `bash -n` deckte es über die bestehende Glob-Schleife bereits ab). Versions-/Vergleichslogik folgt in PR 2 (dort erst eingeführt).

### PR 2 — Update-Helper, Timer & Path-Unit (Pi-seitig)

- [x] `scripts/pi-self-update.sh`: liest `/etc/getraenke/update.env`, fragt das neueste stabile Release-Tag über die GitHub-API ab (`GET /repos/<owner>/<repo>/releases/latest`), vergleicht mit der aktiven Version (Symlink-Ziel), lädt bei Bedarf das private Release-Asset (authentifiziert über die API-`assets[].url`, nicht `browser_download_url`), ruft `pi-release.sh`, schreibt in **jedem** Fall `update-status.json` (Ergebnis: `up_to_date` | `update_available` | `in_progress` | `success` | `failed`, Zeitstempel, Versionen, Auslöser). Modus (nur prüfen vs. voll aktualisieren) wird über den Marker-Dateiinhalt gesteuert, nicht über einen CLI-Flag (siehe Marker-Handshake).
- [x] `scripts/getraenke-update.service` (oneshot, läuft als root), `scripts/getraenke-update.timer` (`OnCalendar` grob 2-wöchentlich, `Persistent=true`) und `scripts/getraenke-update.path` (beobachtet `/var/lib/getraenke/update-requested`, `Unit=getraenke-update.service`).
- [x] Marker-Handshake: Helper liest den Marker-Inhalt (`update`/`check`), konsumiert (löscht) ihn sofort, setzt `in_progress` in der Status-Datei vor dem Download, räumt danach auf. `flock` auf einer Lock-Datei verhindert parallele Läufe (Timer- und Admin-Trigger können sich sonst überschneiden).
- [x] `scripts/update.env.example` + Fine-Grained-Token-Anleitung (`contents:read`, nur dieses Repo).
- [x] **Tests:** `systemd-analyze verify` für Service/Timer/Path (lokal + `ci.yml`); Helper-Skript mit gestubbtem `curl` gegen Fixture-Responses manuell durchgetestet — Szenarien „bereits aktuell" (`up_to_date`), „Check-Marker mit neuerem Tag" (`update_available`, Marker korrekt konsumiert), „voller Update-Lauf inkl. Download + `pi-release.sh`" (inkl. eines erzwungenen Restart-Fehlers, der den automatischen Rollback in `pi-release.sh` korrekt auslöste und als `failed` protokolliert wurde) und „fehlende `update.env`" (Exit 1 mit klarer Fehlermeldung).

### PR 3 — Backend: Status lesen & Update anstoßen

- [x] `UpdateService`: liest `update-status.json` (robust bei fehlender/kaputter Datei/unbekanntem `last_result` → `unknown`), schreibt Marker `update-requested` (atomar via tmp+rename, Inhalt nur `"update"`/`"check"` — kein Payload, keine Zielversion), 409 (`UPDATE_IN_PROGRESS`) wenn `in_progress` oder bereits ein Marker offen ist.
- [x] Routen (Admin-only, `requireRole('admin')`, gemountet unter `/api/v1/update` statt `/api/v1/admin/update` — folgt der bestehenden flachen Ressourcen-Konvention des Repos, z. B. `/api/v1/reports`): `GET /update/status` (aktuelle Version, verfügbare Version, letzte Prüfung, letztes Ergebnis, `in_progress`) und `POST /update` (setzt Marker → 202; 409 wenn bereits offen/`in_progress`). `POST /update/check` (Marker-Inhalt `"check"`) umgesetzt statt eines optionalen CLI-Flags — passt zum Marker-Design aus PR 2.
- [x] Konfiguration: ENV `UPDATE_STATE_DIR` (Dev: `./data`, Prod: `/var/lib/getraenke`, muss mit dem StateDirectory des Pi-Helpers übereinstimmen), Pfade für Marker/Status daraus abgeleitet.
- [x] Audit-Log: `update_requested` mit `actor_id` und `meta.mode` (`update`/`check`).
- [ ] `/api/v1/health` optional um `version` ergänzen — zurückgestellt (optional laut Plan, kein Bedarf für den Admin-Bereich, der `GET /update/status.current_version` ohnehin liefert).
- [x] **Tests:** Supertest (`tests/integration/update.test.ts`) — `GET /update/status` (200 Admin inkl. „unknown" ohne Datei, 403 Member, 401 ohne Token), `POST /update`/`POST /update/check` (202, Marker-Inhalt geprüft, 409 bei offenem Marker, 409 bei `in_progress`-Status, 403 Member); Vitest (`tests/unit/services/UpdateService.test.ts`, 9 Tests) — Status-Parsing (fehlende/kaputte/unbekannte Datei), Marker-Schreiben, Debounce, Audit-Log-Eintrag, Auto-Anlage des State-Verzeichnisses. Gesamte Backend-Suite (345 Tests) grün, Coverage-Ratchet weiterhin erfüllt.

### PR 4 — Frontend: Admin-Bereich „System / Update“

- [x] Neuer Admin-Reiter **„System"** (`/admin/system`, `SystemPage.tsx`): zeigt Badge mit dem aktuellen Ergebnis (u. a. „Aktuell"/„Update verfügbar"/„Noch kein Update-Lauf"), **laufende Version**, **verfügbare Version**, Zeitpunkt der letzten Prüfung inkl. Auslöser (automatisch/manuell).
- [x] Buttons **„Jetzt prüfen"** und **„Jetzt aktualisieren"** (Bestätigungsdialog mit Hinweis auf den kurzen Neustart); solange `in_progress` true ist, pollt die Seite `GET /update/status` alle 4 s und zeigt bei Abschluss automatisch einen Erfolgs-/Fehler-Toast. Beide Buttons sind deaktiviert, während ein Lauf aktiv ist oder eine Anfrage unterwegs ist.
- [x] `updateApi.getStatus()` / `requestUpdate()` / `requestCheck()` (`frontend/src/api/update.ts`); 409 `UPDATE_IN_PROGRESS` wird als verständliche Meldung angezeigt statt als Rohfehler.
- [x] Konsistent mit Hängt!-Tokens (Pergament-Karte mit Korps-Rot-Topstreifen, Eyebrow-Section-Title, bestehende Button-/Badge-Farbpalette) — kein neuer visueller Stil, manuell im Browser gegen den laufenden Dev-Server geprüft (Screenshots: Status „unbekannt", „Update verfügbar", 409-Fehlertoast, Bestätigungsdialog).
- [x] **Tests:** Vitest + RTL (`tests/SystemPage.test.tsx`, 7 Tests) — Rendering „Noch kein Update-Lauf" vs. Versionen/„Update verfügbar", „Jetzt prüfen" ruft die API, „Jetzt aktualisieren" fragt erst per `confirm()` und bricht bei Ablehnung ab, 409-Fehlerfall zeigt die verständliche Meldung, beide Buttons deaktiviert bei `in_progress`. Gesamte Frontend-Suite (102 Tests) grün.

### PR 5 — E2E & Doku

- [x] Playwright-E2E (`e2e/tests/09-admin-update.spec.ts`): Login als Admin → Update-Bereich zeigt aktuelle Version → „Jetzt aktualisieren" schreibt die Marker-Datei (Status-Datei wird direkt in `UPDATE_STATE_DIR` vorgelegt, keine echte Installation im Test-Setup) → UI spiegelt Ergebnis; Abbruch über den Bestätigungsdialog schreibt keinen Marker; Nicht-Admin wird von `/admin/system` weg auf `/buchen` umgeleitet. `global-setup.ts`/`global-teardown.ts` um ein isoliertes `UPDATE_STATE_DIR` erweitert (fester Pfad, unabhängig von Spec-Worker-Prozessen berechenbar — analog zu `E2E_BACKEND_PORT`).
- [x] `docs/AUTO-UPDATE.md` (bereits in PR 2 angelegt): Architektur (Timer → Path-Unit → Helper → `pi-release.sh`), Installation der Units, Token-Setup, Sicherheitsüberlegungen, manuelles Prüfen/Anstoßen, Störungssuche.
- [x] `docs/DEPLOYMENT.md` (PR 1/2) und `docs/RASPBERRY-PI-SETUP.md` (PR 2) bereits verlinkt bzw. um Schritt 10 (Units + `update.env`) ergänzt.
- [x] `ARCHITECTURE.md`: neuer Abschnitt „Auto-Update & Privilege-Separation (M14)" (App schreibt nur die Marker-Datei, root-betriebene Path-Unit/Service übernehmen den Rest, Status-Datei-Rückkanal, `UPDATE_STATE_DIR`, Token-Scope) sowie die drei `/update`-Routen in der API-Übersicht.
- [x] `CHANGELOG.md` (Unreleased, PR 1–4) und `README.md`-Feature-Liste (PR 4) bereits ergänzt.
- [x] **Nebenbei behoben:** Beim Schreiben des E2E-Tests fiel auf, dass die Seite auf schmalen Viewports (Sticky-Header oben, `position: fixed`-TabBar unten) beim automatischen Scrollen Ziel-Elemente teils unter den fixierten Leisten verschwinden lässt (`scrollIntoView` kennt `position: sticky`/`fixed`-Overlays nicht). `frontend/src/index.css` um `scroll-padding-top`/`scroll-padding-bottom` ergänzt — ein generischer, vorher latenter Bug, den die neue (weiter unten liegende) System-Seite als Erste sichtbar gemacht hat.

### Sicherheits- & Betriebs-Hinweise (bei der Umsetzung beachten)

- **Vertrauensanker Release:** Der Helper installiert nur Assets aus **unserem** Repo/Tag. Optional (späterer Ausbau): Checksum-/Signatur-Prüfung des Tarballs vor dem Entpacken.
- **Kein beliebiges Ziel aus der App:** Der Marker enthält keine Versionsangabe; die App kann so kein Downgrade/keine fremde Version erzwingen.
- **Restart-Fenster:** Ein Update startet den Dienst kurz neu (wenige Sekunden). Der nächtliche Timer minimiert die Störung; der Admin-Button warnt vor.
- **Rollback:** Schlägt der Smoke-Test fehl, swappt `pi-release.sh` automatisch auf das vorherige Release zurück (identisch zum bestehenden Tag-Deploy).
- **Token-Scope:** Fine-Grained-PAT strikt auf dieses Repo + `contents:read`; nur für den Helper (root/deploy-Kontext) lesbar, **nie** im `getraenke`-App-Prozess.

**Definition of Done:** Ohne manuellen Tag-Push zieht der Pi zweiwöchentlich automatisch das neueste stabile Release, sichert vorher die DB, swappt atomar und rollt bei fehlgeschlagenem Smoke-Test selbsttätig zurück. Ein Admin sieht im Admin-Bereich die laufende und die verfügbare Version und kann per Button „Jetzt prüfen" bzw. „Jetzt aktualisieren" auslösen; der Anstoß erfolgt über eine Marker-Datei ohne jegliche sudo-Rechte im App-Prozess. Die App macht selbst keinen Netzabruf zu GitHub. Lint (inkl. `shellcheck`), `systemd-analyze verify`, Unit-, Integrations- und E2E-Tests grün.

---

## Rollen-Matrix (für Solo- oder Kleinteam-Setup)

| Rolle             | Verantwortung                          |
| ----------------- | -------------------------------------- |
| Tech Lead         | Architektur-Entscheidungen, PR-Reviews |
| Backend Dev       | M2, M3, M4, M6                         |
| Frontend Dev      | M5                                     |
| DevOps / Pi-Admin | M1 (Tooling), M7                       |
| QA / Tester       | begleitend ab M3 (E2E-Skripte ab M5)   |

In einem Solo-Setup übernimmt eine Person alle Rollen — der Plan ändert sich nicht, aber die Zeitschätzungen verdoppeln sich realistisch.
