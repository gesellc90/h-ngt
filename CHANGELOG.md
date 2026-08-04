# Changelog

Alle nennenswerten Änderungen an diesem Projekt werden in dieser Datei dokumentiert.

Das Format basiert auf [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
und das Projekt folgt [Semantic Versioning](https://semver.org/lang/de/).

## [Unreleased]

### Added

- **M14 (PR 5) — E2E-Test & Doku-Abschluss**
  - Playwright-E2E (`09-admin-update.spec.ts`): Update-Status inkl. Versionen anzeigen, „Jetzt aktualisieren" schreibt die Marker-Datei, Dialog-Abbruch schreibt keinen Marker, Nicht-Admin wird umgeleitet. `global-setup.ts` legt dafür ein isoliertes `UPDATE_STATE_DIR` für den E2E-Backend-Prozess an.
  - `ARCHITECTURE.md`: neuer Abschnitt „Auto-Update & Privilege-Separation" sowie die `/update`-Routen in der API-Übersicht.
  - **Fix (durch den E2E-Test entdeckt):** `scroll-padding-top`/`scroll-padding-bottom` in `frontend/src/index.css` ergänzt, damit `scrollIntoView` Ziele nicht mehr unter dem sticky Header bzw. der fixierten mobilen TabBar verschwinden lässt — betraf potenziell jede Seite mit Inhalt unterhalb der ersten Bildschirmhöhe auf schmalen Viewports.

- **M14 (PR 4) — Frontend: Admin-Bereich „System / Update"**
  - Neuer Admin-Reiter „System" (`/admin/system`): zeigt den Update-Status (Badge, laufende/verfügbare Version, Zeitpunkt der letzten Prüfung inkl. Auslöser) und die Buttons „Jetzt prüfen"/„Jetzt aktualisieren".
  - „Jetzt aktualisieren" fragt vorher eine Bestätigung ab (Hinweis auf den kurzen Neustart der App). Solange ein Update läuft, pollt die Seite den Status und zeigt bei Abschluss automatisch einen Erfolgs-/Fehler-Toast; ein bereits laufendes Update (409) wird als klare Meldung statt Rohfehler angezeigt.
  - Neues API-Modul `updateApi` (`getStatus`/`requestUpdate`/`requestCheck`) und Typ `UpdateStatus` in `types/api.ts`.
  - 7 neue Vitest/RTL-Tests (`SystemPage.test.tsx`); manuell im Browser gegen den laufenden Dev-Server verifiziert.

- **M14 (PR 3) — Backend: Update-Status lesen & Update anstoßen**
  - `UpdateService`: liest `update-status.json` robust (fehlende/kaputte Datei oder unbekanntes `last_result` → `"unknown"`, wirft nie), schreibt die Marker-Datei `update-requested` atomar (Inhalt nur `"update"`/`"check"`) und wirft 409 `UPDATE_IN_PROGRESS`, wenn bereits ein Update läuft oder ein Marker offen ist.
  - Neue Routen `GET /api/v1/update/status`, `POST /api/v1/update` und `POST /api/v1/update/check` (alle Admin-only via `requireRole('admin')`). Kein Endpunkt löst selbst ein Update aus — sie schreiben nur die Marker-Datei, die der Pi-lokale `getraenke-update.path` beobachtet.
  - Neue ENV-Variable `UPDATE_STATE_DIR` (Dev: `./data`, Prod: `/var/lib/getraenke`), muss mit dem StateDirectory des Auto-Update-Helpers übereinstimmen.
  - Audit-Log-Event `update_requested` (`actor_id`, `meta.mode`).
  - 9 neue Unit-Tests (`UpdateService`) + 11 neue Integrationstests (`update`-Router); gesamte Backend-Suite (345 Tests) grün.

- **M14 (PR 2) — Auto-Update-Helper, Timer & Path-Unit**
  - `scripts/pi-self-update.sh`: fragt das neueste stabile GitHub-Release ab, vergleicht mit der aktiven Version, lädt bei Bedarf das (private, tokenauthentifizierte) Release-Asset und installiert es über `pi-release.sh`. Schreibt nach jedem Lauf `/var/lib/getraenke/update-status.json` (Version, Zeitstempel, Ergebnis, Auslöser). Modus („nur prüfen" vs. „aktualisieren") wird über den Inhalt einer Marker-Datei gesteuert, die konsumiert (gelöscht) wird; ohne Marker (Timer-Trigger) läuft ein voller Update-Lauf. `flock` verhindert parallele Läufe.
  - `scripts/getraenke-update.service` (root, oneshot), `scripts/getraenke-update.timer` (grob zweiwöchentlich, `Persistent=true` für nachgeholte Läufe) und `scripts/getraenke-update.path` (beobachtet die Marker-Datei) — bilden zusammen die Privilege-Separation: der App-Prozess selbst bleibt unprivilegiert und schreibt nur die harmlose Marker-Datei; die eigentliche Installation läuft über eine separate, root-betriebene systemd-Infrastruktur.
  - `scripts/update.env.example`: Konfigurationsvorlage für das Fine-Grained-GitHub-Token (`Contents: Read-only`, nur dieses Repo), `/etc/getraenke/update.env`, Mode 0600, nur für den root-Helper lesbar — nie im App-Prozess.
  - `docs/AUTO-UPDATE.md` (neu): Architektur, Privilege-Separation, Status-Rückkanal, Störungssuche. `RASPBERRY-PI-SETUP.md` um Installationsschritt 10 ergänzt; `DEPLOYMENT.md` verlinkt.
  - `deploy.yml`: `pi-self-update.sh` ist jetzt Teil des Release-Tarballs. `ci.yml`: `systemd-analyze verify` und `shellcheck` decken die neuen Units/Skripte ab.

- **M14 (PR 1) — Pi-Release-Logik extrahiert & Release-Asset**
  - `scripts/pi-release.sh`: kapselt die komplette Release-Installation auf dem Pi (Snapshot, DB-Backup, Entpacken, `npm ci --omit=dev`, Migrationen, atomarer Symlink-Swap, Service-Restart, Smoke-Test, automatischer Rollback bei Fehler nach dem Swap, Aufräumen alter Releases). Konfigurierbar über `RELEASES_DIR`, `CURRENT_LINK`, `DB_PATH`, `BACKUP_DIR`, `HEALTH_URL`, `KEEP_RELEASES`. Ersetzt die bisher inline in `deploy.yml` verteilten Steps 1:1 im Verhalten — ist als gemeinsame Grundlage für den Tag-Deploy **und** den Auto-Update-Helper gedacht.
  - `deploy.yml`: Pi-Job ruft nur noch `pi-release.sh` auf; Build-Job hängt den Release-Tarball zusätzlich als GitHub-Release-Asset ans Tag an (dauerhaft abrufbar, unabhängig von der 30-Tage-Actions-Artefakt-Retention).
  - `ci.yml`: neuer `shellcheck`-Schritt für `scripts/pi-release.sh`.

- **M13 — Wirtschaftskommission & Konten-Streichung**
  - Migration 012: neue Spalten an `members` — `is_wirtschaftskommission` (Capability-Flag analog `can_book_for_others`) und `struck_until` (nullable ISO-Zeitstempel). Bewusst als Flag statt neuem `role`-Wert modelliert, da ein Rebuild der `members`-Tabelle wegen der `ON DELETE RESTRICT`-Fremdschlüssel nicht gefahrlos möglich ist.
  - Neue Konto-Variante „Wirtschaftskommission" (WK): darf Personen-Konten streichen und entstreichen. Streichen und Entstreichen dürfen sowohl WK-Konten als auch Admins (`requireWkOrAdmin`-Middleware; JWT-Payload um `is_wk` erweitert, wird — wie die Rolle — bei jeder Anfrage frisch aus der DB übernommen).
  - Streichung: `MembersService.strike` setzt `struck_until` auf jetzt + 2 Wochen, `unstrike` setzt zurück (→ 409 `NOT_STRUCK`, wenn nicht gestrichen); Theken-Konten sind nicht streichbar (→ 409 `NOT_STRIKEABLE`). Audit-Log-Events `member_struck` / `member_unstruck`.
  - Buchsperre: `BookingService` blockiert Personenbuchungen auf gestrichene Konten (→ 409 `MEMBER_STRUCK`) — betrifft Selbst- und Theken-Buchungen. Zeiger-Buchungen laufen auf die Vereinskasse und bleiben erlaubt. Nach Ablauf der 2 Wochen ist das Konto automatisch wieder bebuchbar.
  - Routen: `POST /members/:id/strike`, `POST /members/:id/unstrike` und `GET /members/strikeable` (alle WK oder Admin); `POST/PATCH /members` akzeptieren `is_wirtschaftskommission`.
  - Frontend: neuer Bereich „Streichen" (`/wk`, Reiter für WK **und** Admin) mit nach Kategorie gruppierter Kontenliste, Streichen (mit Bestätigung) und vorzeitigem Entstreichen; gestrichene Konten in der Theken-Auswahl ausgeblichen, durchgestrichen und nicht anwählbar („gestrichen bis <Datum>"); Hinweisbanner samt gesperrten Getränke-Buttons in der eigenen Stube; WK-Spalte/Checkbox in der Admin-Mitgliederverwaltung.
  - Seed: Demo-Konto `wiko` (Anzeigename „Wirtschaftskommission"), in Dev mit Passwort `wiko123`.
  - 21 zusätzliche Tests (Backend: MembersRepo-Unit + WK-/Streich-Integration; Frontend: `StreichenPage` + gestrichenes Konto in `ThekePage`).

- **M12 — Getränke-Kategorien & Verbrauchs-Auswertung**
  - Migration 011: Tabelle `drink_categories` (STRICT, eindeutiger Name `COLLATE NOCASE`, `sort_order` für die Anzeige-Reihenfolge); Standardkategorie „Sonstige" wird angelegt und alle bestehenden Getränke ihr zugeordnet; neue Spalte `drinks.category_id` (FK `ON DELETE RESTRICT`, Index)
  - `DrinkCategoriesRepo` (findAll sortiert nach `sort_order`, create ans Ende, update, delete, `reorder`, `countDrinks`) und `DrinkCategoriesService` mit Audit-Log und Löschschutz (nur leere Kategorien löschbar → 409 `CATEGORY_NOT_EMPTY`)
  - Routen `GET /drink-categories` (alle Auth), `POST/PATCH/DELETE /drink-categories/:id` und `PUT /drink-categories/order` (Admin); `DrinksRepo`/`DrinksService` um die Pflicht-Kategorie erweitert (`category_id` beim Anlegen validiert, Änderung möglich), Getränke-Listen mit Kategorie-Join sortiert
  - Verbrauchs-Auswertung: `BookingsRepo.findConsumption(from, to)` (alle nicht-stornierten Buchungen inkl. Zeiger-Buchungen), `ReportService.calculateConsumption` (Anzahl + Umsatz je Getränk, nach Kategorie gruppiert, mit Zwischen- und Gesamtsummen), Route `GET /reports/consumption?from&to&format` als CSV und PDF
  - Frontend: Admin-Reiter „Kategorien" (`/admin/kategorien`) mit Anlegen, Umbenennen, Löschen und Reihenfolge (Hoch/Runter); `DrinksPage` mit Kategorie-Pflichtfeld beim Anlegen und Kategorie-Spalte zum Umhängen; Buchungs- und Theken-Ansicht clustern die Getränke nach Kategorie (in Admin-Reihenfolge); `ReportPage` um die Verbrauchs-Auswertung mit frei wählbarem Zeitraum ergänzt
  - Seed: Demo-Kategorien „Alkoholfrei" und „Bier"; Seed-Getränke entsprechend zugeordnet
  - 31 zusätzliche Backend-Tests (DrinkCategoriesRepo, ReportService-Verbrauch, Kategorie- und Report-Integration)

- **M11 — Zeiger (Couleurbesuch & Verbindungsveranstaltungen)**
  - Migration 010: Tabellen `verbindungen` und `zeiger` (STRICT); `bookings.zeiger_id` als nullable FK — Zeiger-Buchungen zählen nicht zum Personen-Saldo
  - `VerbindungenRepo`, `ZeigerRepo` mit vollständigem CRUD; `BookingsRepo.create` um `zeiger_id` erweitert
  - `ZeigerService`: öffnen, abrufen, aktualisieren (BBr/Gäste), schließen (Ersteller oder Admin); Audit-Log für öffnen + schließen
  - Routen `POST/GET /zeiger`, `GET/PATCH /zeiger/:id`, `POST /zeiger/:id/close`, `GET /zeiger/:id/bookings`
  - `POST /bookings` akzeptiert `zeiger_id`; Storno auf Zeiger-Buchungen möglich; `GET /bookings/me` und Reports schließen Zeiger-Buchungen aus (`zeiger_id IS NULL`)
  - Admin-CRUD für Verbindungen: `GET/POST/PATCH/DELETE /verbindungen` (GET für alle Auth, Mutationen nur Admin); Admin-Frontend `VerbindungenPage` mit Tabelle, Inline-Edit und Reaktivieren
  - Frontend-Reiter „Zeiger" (`/zeiger`, `/zeiger/:id`): Liste offen/geschlossen, Anlegen-Formular (Freitext + Verbindungs-Schnellauswahl + BBr/Gäste), Detail-/Buchungsansicht mit Storno, Schließen-Button
  - Zeiger-Report in `ReportService`: `calculateZeiger(id)` und `calculateAllZeiger(from?, to?)`; CSV + PDF-Export; Admin-Frontend in `ReportPage` — Einzel-Zeiger und Übersicht (Zeitraum-Filter)
  - E2E-Spec `08-zeiger-flow`: Zeiger öffnen → buchen → schließen; Konflikt-Prüfung (Buchung auf geschlossenen Zeiger → 409)
  - 258 Backend-Tests (Unit + Integration), 65 Frontend-Tests, E2E-Spec grün

- **M10 — Erweitertes Mitgliederprofil (Profilbild & E-Mail)**
  - Migration 009: Spalte `email` (nullable, `COLLATE NOCASE`, partieller `UNIQUE`-Index für gesetzte Werte) und `avatar_path` an `members`
  - Self-Service-Endpunkte: `PATCH /auth/me` (Anzeigename, E-Mail, Passwort), `POST /auth/me/avatar` (Upload → 256×256 WebP via `sharp`), `DELETE /auth/me/avatar`
  - Eindeutigkeitsprüfung der E-Mail im Service-Layer → 409 `EMAIL_TAKEN`
  - Profilbilder im Dateisystem unter `AVATAR_DIR` (Dev: `./data/avatars`, Prod: `/var/lib/getraenke/avatars/`), ausgeliefert über `GET /avatars/:file`
  - Frontend `ProfilePage`: Avatar-Kreis (Bild oder Initialen-Fallback), Upload/Löschen-Buttons, E-Mail-Anzeige in der Profil-Karte, Bearbeitungsformular für Anzeigename + E-Mail
  - `AuthContext.updateMember()` für lokale State-Aktualisierung nach Profil-Änderungen ohne Re-Login
  - Playwright-E2E-Spec `07-profil`: E-Mail setzen + in Karte sehen, Profilbild hochladen + Avatar erscheint, Konflikt-Toast bei doppelter E-Mail
- **M10 — Nachgezogene Admin-/UI-Punkte**
  - Admin-Avatar-Verwaltung: `POST /members/:id/avatar` und `DELETE /members/:id/avatar` (Admin-Pendant zu den Self-Service-Routen); gemeinsame Avatar-Verarbeitung in `utils/avatar.ts` (multer + `sharp`), von Self-Service und Admin genutzt
  - Admin `MembersPage`: E-Mail-Spalte, Inline-E-Mail-Editor (leerer Wert entfernt die Adresse, Konflikt-Toast bei `EMAIL_TAKEN`) und E-Mail-Feld im Anlegen-Formular
  - Echtes Profilbild im `WordmarkHeader`/`Layout` — Avatar-Kreis zeigt das hinterlegte Bild, Initialen nur noch als Fallback
  - Doku: `AVATAR_DIR` im `StateDirectory` (`/var/lib/getraenke/avatars`) samt EnvironmentFile-Beispiel und Backup-Hinweis in `DEPLOYMENT.md`; separater Avatar-Backup-Cron-Job in `RASPBERRY-PI-SETUP.md`; Admin-Avatar-Endpunkte in `ARCHITECTURE.md`
- **M9 (in Arbeit) — Allgemein-Konto & Mitglieder-Kategorien, PR 1: Datenschicht**
  - Migration 007: Spalten `member_status` (`aktiv`|`inaktiv`|`alter_herr`|`freund`) und `can_book_for_others` an `members`. `member_status` ist eine vom `is_active`-Login-/Soft-Delete-Flag unabhängige Kategorie – Mitglieder ohne Login (z. B. „Freunde der Verbindung") bleiben bebuchbar
  - `MembersRepo.findBookable()`: liefert aktive Mitglieder ohne Buchen-für-andere-Recht, sortiert nach Kategorie (Aktive → Inaktive → Alte Herren → Freunde)
  - `POST /members` akzeptiert `member_status` (Default `aktiv`), `PATCH /members/:id` zusätzlich `member_status` und `can_book_for_others`
  - Seed legt ein „Allgemein"-Konto an (`username=allgemein`, `can_book_for_others=1`; Passwort vom Admin zu setzen)
- **M9 (in Arbeit) — Allgemein-Konto & Mitglieder-Kategorien, PR 2: Buchen für andere**
  - Migration 008: Spalte `booked_by_id` an `bookings` (nullable, `ON DELETE SET NULL`). Hält fest, wer eine Buchung ausgelöst hat; `NULL` = Selbstbuchung, sonst die ID des buchenden Kontos. `member_id` bleibt das Ziel der Buchung
  - `POST /bookings` akzeptiert optionales `member_id`: nur Konten mit `can_book_for_others=1` dürfen für andere buchen (sonst `403 FORBIDDEN`), unbekanntes Ziel ergibt `404`
  - `GET /bookings/member/:id`: Buchungen eines bestimmten Mitglieds (paginiert) – fremde nur für Konten mit `can_book_for_others`, eigene immer
  - Storno durch das Allgemein-Konto: Konten mit `can_book_for_others` dürfen die von ihnen selbst angelegten Fremdbuchungen im 5-Minuten-Fenster stornieren
  - Audit-Log: `booking_created`/`booking_voided` halten `actor_id` (buchendes Konto) und `meta.member_id` (Ziel) fest
- **M9 (in Arbeit) — Allgemein-Konto & Mitglieder-Kategorien, PR 3: Theken-Flow (Frontend)**
  - `GET /auth/me` liefert jetzt das vollständige öffentliche Member-Objekt inkl. `member_status` und `can_book_for_others` (statt nur des JWT-Claims), damit das Frontend den Theken-Modus erkennt
  - `GET /members/bookable`: für Konten mit `can_book_for_others` zugängliche Liste der bebuchbaren Mitglieder (nach Kategorie sortiert), ohne Admin-Recht
  - Theken-Ansicht unter `/buchen`: Konten mit `can_book_for_others` sehen statt der Selbstbuchung eine Mitgliederauswahl (vier Kategorie-Abschnitte + Suchfeld), wählen ein Mitglied und buchen/stornieren in dessen Namen; „Fertig" führt zurück zur Übersicht
  - Admin-Mitgliederverwaltung: Kategorie-Auswahl beim Anlegen sowie inline editierbare Spalten „Kategorie" und „Theke" (Buchen-für-andere-Schalter)
- **M9 (in Arbeit) — Allgemein-Konto & Mitglieder-Kategorien, PR 4: E2E & Doku**
  - Playwright-E2E-Spec `06-theke-flow`: Login als Allgemein-Konto → nach Kategorie gruppierte Übersicht → Mitglied wählen → Strich setzen → Storno → „Fertig"; Gegenprobe, dass ein normales Mitglied weiterhin die eigene Stube sieht
  - `ARCHITECTURE.md`: Members-Schema (`member_status`, `can_book_for_others`), Endpunkt `GET /members/bookable` und Designnotiz zum Theken-Modus ergänzt
- Initiale Projektstruktur (Backend, Frontend, Doku, CI)
- Architekturdokumentation (`ARCHITECTURE.md`)
- Contribution Guide (`CONTRIBUTING.md`)
- Meilensteinplan (`docs/MILESTONES.md`)
- **M7 Hälfte B (in Arbeit)**
  - systemd-Service-Unit `scripts/getraenke.service` mit gehärtetem Sandbox-Profil (NoNewPrivileges, ProtectSystem=strict, ProtectHome, PrivateTmp, PrivateDevices, RestrictAddressFamilies, SystemCallFilter, leeres CapabilityBoundingSet, MemoryMax=512M, StateDirectory=getraenke)
  - Deployment-Doku `docs/DEPLOYMENT.md` mit Verzeichnis-Layout, EnvironmentFile-Beispiel, Service-Account und Verifikations-Befehlen (`systemd-analyze verify`/`security`)
  - GitHub Actions Workflow `.github/workflows/deploy.yml` (Trigger auf SemVer-Tag `v*.*.*`): Build auf `ubuntu-latest`, Deploy auf `[self-hosted, raspberry-pi]` mit DB-Backup → Migration → atomarem Symlink-Swap (`ln -sfn` + `mv -Tf`) → Restart → Smoke-Test gegen `/api/v1/health`. Automatischer Rollback bei Fehlern nach Swap, Aufbewahrung der letzten 5 Releases
  - sudoers-Snippet `scripts/getraenke-deploy.sudoers` (minimaler NOPASSWD-Eintrag für `systemctl restart/status/is-active` + Migration als App-User)
  - Wrapper-Skript `scripts/deploy-migrate.sh` für DB-Migrationen während des Deploys (lädt `/etc/getraenke/env`, ruft `migrate-cli.js` als App-User `getraenke` auf)
  - CI-Erweiterung in `.github/workflows/ci.yml`: neuer Job `lint-deploy` mit `systemd-analyze verify`, `visudo -cf` und `bash -n` für alle Skripte
  - Playwright-E2E-Suite (`e2e/`) als eigener npm-Workspace `@getraenke/e2e`. Globaler Setup-Hook startet gebautes Backend + `vite preview` gegen eine temporäre SQLite-DB, seedet Test-Daten (bcrypt-Hashes für admin/anna/bernd, „alte" Buchung für Storno-Negativ-Test). Fünf Specs: Login, Buchung, Storno (positiv + negativ), Admin-Mitgliederanlage, PDF-Report-Download
  - GitHub Actions Workflow `.github/workflows/e2e.yml` (Trigger auf Push/PR, Playwright-Browser-Cache, Trace-Upload bei Fehler)
  - Neue Doku `docs/TESTING.md` (Test-Schichten, lokale Befehle, Trace-Viewer, Test-Daten-Schema)
  - `frontend/vite.config.ts`: neuer `preview`-Block mit `/api`-Proxy auf `E2E_BACKEND_PORT` (Default 3101)
  - Pi-Grundeinrichtungs-Doku `docs/RASPBERRY-PI-SETUP.md`: OS-Flash via Imager, Production-Hardening (SSH-Key-Only, ufw, fail2ban, unattended-upgrades, timesyncd), Node 20 via NodeSource, build-essential für `better-sqlite3`-ARM-Build, User- und Verzeichnis-Layout, Cron-Backup, Smoke-Test, Troubleshooting-Tabelle
  - Runner-Installation-Doku `docs/RUNNER-SETUP.md`: ARM64-Tarball-Download mit Integritäts-Check, `config.sh` mit Labels `self-hosted,raspberry-pi,arm64`, `svc.sh install` als systemd-Service, Sicherheits-Hinweise
- **M6 — Reporting & Export (PDF/CSV)**
  - `ReportService`: `calculateMonthly()` und `calculateAllMembers()` aggregieren Buchungen pro Monat, gruppiert nach Getränk, mit Einzelsummen und Gesamtbetrag
  - CSV-Export: UTF-8-BOM für Excel-Kompatibilität, Semikolon-Trenner, Komma als Dezimaltrennzeichen, deutsches Datumsformat, CRLF-Zeilenenden
  - PDF-Export via PDFKit: Einzelbericht (Header, Buchungstabelle, Zusammenfassung, Summenzeile, Footer mit Erstellungsdatum)
  - Sammel-PDF: alle aktiven Mitglieder mit Inhaltsverzeichnis auf Seite 1, je eine Seite pro Mitglied
  - Endpunkt `GET /api/v1/reports/monthly?memberId=&year=&month=&format=csv|pdf` (Admin-only)
  - Endpunkt `GET /api/v1/reports/all?year=&month=&format=pdf` (Admin-only)
  - Frontend `ReportPage`: Auswahl Monat/Jahr/Mitglied, Download-Buttons CSV + PDF (einzeln) + Sammel-PDF, Toast-Feedback, Loading-Spinner
  - `frontend/src/api/reports.ts`: `downloadMonthlyReport()` + `downloadAllMembersReport()` mit Blob-Download und Content-Disposition-Parsing

### Fixed

- **M9 — Theken-Modus griff erst nach Reload:** `POST /auth/login` lieferte nur ein abgespecktes Member-Objekt (ohne `can_book_for_others`), sodass die Theken-Übersicht direkt nach dem Login nicht erschien. Login gibt nun – wie `/auth/me` – das vollständige `PublicMember`-Objekt zurück
- **Mobile-Layout:** das letzte Seitenelement (z. B. der „Fertig"-Button) verschwand hinter der fixierten Bottom-TabBar – Platzhalter im `<main>` ergänzt
- **Backend-Build:** Migrations-`.sql`-Dateien werden jetzt via `backend/scripts/copy-migrations.mjs` nach `dist/db/migrations/` kopiert. Ohne diesen Schritt würde `node dist/db/migrate-cli.js` (genutzt in PR 2 vom Pi-Deploy) zur Laufzeit keine Migrationen finden, weil `tsc` Nicht-TS-Files ignoriert
- **M1 — Projekt-Setup & Tooling**
  - Mono-Repo mit npm-Workspaces (`backend/`, `frontend/`)
  - Backend-Skeleton: Express, pino, Zod, `/api/v1/health`-Route, graceful Shutdown auf SIGTERM/SIGINT
  - Frontend-Skeleton: React 18 + Vite + TailwindCSS v3 + React Router, Dev-Proxy `/api → :3001`
  - TypeScript 5 überall mit `strict: true` und `noUncheckedIndexedAccess`
  - Smoke-Tests: Vitest + Supertest (Backend), Vitest + Testing-Library (Frontend)
  - ESLint Flat-Config (zentral im Root) + Prettier + Husky pre-commit + lint-staged
  - `npm run dev` startet Backend und Frontend parallel via `concurrently`
  - `.gitignore`, `.editorconfig`, `.nvmrc` (Node 20)
- **M3 — Authentifizierung & Sicherheit**
  - `bcryptjs`-Passwort-Hashing (Cost 10) mit Timing-Safe-Dummy-Vergleich bei unbekannten Usern
  - `AuthService`: Login, JWT-Issuance (HS256, 8h, JTI via `crypto.randomUUID`)
  - `POST /api/v1/auth/login` mit Zod-Validierung, Rate-Limit (5 Versuche / 15 Min / IP)
  - `GET /api/v1/auth/me` — gibt eigene Daten zurück (geschützt)
  - `POST /api/v1/auth/logout` — invalidiert Token via JTI-Blocklist in SQLite (geschützt)
  - `authenticate`-Middleware (Bearer-Token) + `requireRole`-Middleware
  - Migration 006: `token_blocklist`-Tabelle mit automatischem Cleanup abgelaufener Einträge
  - `AuditLogRepo` + `TokenBlocklistRepo`
  - Audit-Log-Einträge für Login-Erfolg und -Fehlschlag (mit IP und User-Agent)
  - `JWT_SECRET` in `env.ts` als required (min. 32 Zeichen)
  - Migrationen werden beim Serverstart automatisch ausgeführt

### Changed

- `ARCHITECTURE.md`: Verzeichnisstruktur auf TypeScript (`.ts`/`.tsx`) umgestellt, Build- und Run-Strategie-Tabelle ergänzt (Dev: `tsx watch` / `vite`, Prod: `tsc → dist/` / `vite build`)
- `backend/src/db/seed.ts`: veralteter Header-Kommentar („Passwörter werden ab M3 durch bcrypt-Hashes ersetzt") an die M3-Realität angepasst — der Seed lässt `password_hash` bewusst NULL, Initial-Passwort muss von einem Admin gesetzt werden; E2E-Setup übernimmt das Hashing in `e2e/seed/test-seed.mjs`
- `docs/DEPLOYMENT.md`: neue Sektion „Bekannte Limitierungen" mit den zwei offenen Code-Folge-Issues aus M7 Hälfte B (HOST-Binding wird ignoriert, Frontend wird nicht via `express.static` ausgeliefert)

### Deprecated

- _Noch nichts deprecatet_

### Removed

- _Noch nichts entfernt_

### Fixed

- _Noch keine Fixes_

### Security

- _Keine sicherheitsrelevanten Änderungen bisher_

---

## [0.1.0] - TBD

Erste interne Alpha-Version. Siehe `docs/MILESTONES.md` für den geplanten Inhalt von M1–M3.

<!--
Vorlage für neue Releases:

## [x.y.z] - YYYY-MM-DD

### Added
- ...

### Changed
- ...

### Fixed
- ...
-->

[Unreleased]: https://github.com/gesellc90/h-ngt/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/gesellc90/h-ngt/releases/tag/v0.1.0
