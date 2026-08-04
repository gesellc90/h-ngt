# Architecture

## Übersicht

Die Anwendung folgt einer klassischen Drei-Schichten-Architektur, deployed als Single-Node-System auf einem Raspberry Pi.

```
┌────────────────────┐      HTTP/JSON      ┌──────────────────────┐      SQL       ┌──────────────┐
│  React SPA (Vite)  │ ──────────────────▶ │  Express REST API    │ ─────────────▶ │  SQLite DB   │
│  TailwindCSS       │ ◀────────────────── │  JWT-Auth, Zod       │ ◀───────────── │  WAL-Mode    │
└────────────────────┘                     └──────────────────────┘                └──────────────┘
        │                                            │
        └──── statisch ausgeliefert von Express (in Produktion) ────┘
```

In Produktion liefert Express auch das gebuildete Frontend aus (`dist/`), sodass nur ein Port (`3001`) im Vereins-WLAN exponiert werden muss.

## Tech-Stack

### Backend

- **Node.js 20 LTS** — moderne ES-Module, native Test-Runner verfügbar
- **TypeScript 5** — `strict: true`; Dev über `tsx watch`, Prod-Build über `tsc` nach `dist/`
- **Express 4** — schlankes, weit verbreitetes Web-Framework
- **better-sqlite3** — synchrone SQLite-Bibliothek, deutlich schneller als `node-sqlite3` für embedded Use-Cases
- **Zod** — Schema-Validierung für Request-Bodies und ENV
- **jsonwebtoken + bcrypt** — Auth
- **pino** — strukturiertes Logging
- **PDFKit** — PDF-Erzeugung für Monatsabrechnungen

### Frontend

- **React 18** mit Hooks
- **TypeScript 5** — Vite-Template `react-ts`
- **Vite** — Build-Tool, schnelles HMR
- **React Router** (`react-router-dom`) — Client-Side Routing
- **Server-State & Auth** — schlanker `fetch`-Wrapper (`src/api/client.ts`) plus
  React-Context (`AuthContext`, `ToastContext`); bewusst ohne zusätzliche
  Data-Fetching-Bibliothek
- **TailwindCSS** — Utility-First Styling
- **lucide-react** — Icons

### Datenhaltung

SQLite im **WAL-Mode** (Write-Ahead-Logging) für bessere Lese-Performance bei gleichzeitigen Buchungen. Datenbank-Datei liegt unter `backend/data/getraenke.db` (Dev) bzw. `/var/lib/getraenke/getraenke.db` (Prod).

## Datenbankschema

> **Quelle der Wahrheit:** die versionierten Migrationen unter
> [`backend/src/db/migrations/`](backend/src/db/migrations/). Alle Tabellen sind
> `STRICT`, Zeitstempel werden als ISO-8601-UTC (`strftime('%Y-%m-%dT%H:%M:%fZ')`)
> gespeichert. Die folgende Übersicht ist bewusst verdichtet — bei Abweichungen
> gelten die Migrationen.

**`members`** (001, erweitert durch 007/009/012) — Vereinsmitglieder + Admins:
`id`, `username` (NOCASE UNIQUE), `display_name`, `password_hash` (nullable, bis
ein Admin es setzt), `role` (`admin`|`member`), `is_active` (0/1, Login-/
Soft-Delete-Flag), `member_status` (`aktiv`|`inaktiv`|`alter_herr`|`freund`),
`can_book_for_others` (0/1), `is_wirtschaftskommission` (0/1, WK-Capability-Flag),
`struck_until` (nullable ISO-Zeitstempel; gestrichen, solange in der Zukunft),
`email` (NOCASE, partieller UNIQUE-Index nur wenn gesetzt), `avatar_path`
(relativer Dateiname), `created_at`, `updated_at` (via Trigger aktuell gehalten).

**`drinks`** (002) — Getränke-Katalog: `id`, `name` (NOCASE UNIQUE),
`is_available` (0/1), `created_at`, `updated_at`.

**`drink_prices`** (003) — Preis-Historie (nie überschreiben): `id`,
`drink_id` → drinks, `price_cents` (≥ 0), `valid_from`, `created_at`. Der jeweils
aktuelle Preis ist der Eintrag mit dem größten `valid_from`.

**`bookings`** (004, erweitert durch 008/010) — Append-only: `id`,
`member_id` → members, `drink_id` → drinks, `price_cents_snapshot` (≥ 0,
Preis-Snapshot zum Buchungszeitpunkt), `booked_at`, `voided_at` (NULL = aktiv),
`void_reason`, `booked_by_id` → members (NULL = Selbstbuchung, sonst das
buchende Theken-Konto), `zeiger_id` → zeiger (NULL = Personenbuchung).

**`audit_log`** (005) — sicherheitsrelevante Aktionen: `id`, `event_type`,
`actor_id` → members, `target_type`, `target_id`, `meta` (JSON-String),
`created_at`.

**`token_blocklist`** (006) — widerrufene JWTs (Logout): `jti` (PK),
`expires_at`, `created_at`. Abgelaufene Einträge werden beim Login geprunt.

**`verbindungen`** / **`zeiger`** (010) — Couleur-Stammdaten und
„Zeiger" (Couleurbesuche/Veranstaltungen, deren Buchungen auf die Vereinskasse
statt auf ein Mitglied laufen). `zeiger.status` ∈ `offen`|`geschlossen`.

### Designentscheidungen

- **Preise in Cents als INTEGER** — vermeidet Float-Rundungsfehler.
- **Append-Only Buchungen** — keine `DELETE`s, Stornierungen über `voided_at`. Macht Abrechnungen nachvollziehbar.
- **Preis-Snapshot in `bookings.price_cents_snapshot`** — damit nachträgliche Preisänderungen alte Abrechnungen nicht verfälschen.
- **`drink_prices` als Historie** — der aktuelle Preis ist der jüngste `valid_from`-Eintrag; alte Preise bleiben für die Nachvollziehbarkeit erhalten.
- **Abrechnungsmonat in Europe/Berlin** — Monatsgrenzen werden in der Vereinszeitzone berechnet und nach UTC konvertiert (`ReportService.monthBounds`), damit Buchungen um Mitternacht im richtigen Monat landen.
- **Theken-/Allgemein-Konto (`can_book_for_others`)** — ein Konto mit gesetztem Flag bucht stellvertretend für andere. Das Frontend schaltet nach dem Login allein anhand dieses Flags zwischen der eigenen Stube (`BookingPage`) und der nach `member_status` gruppierten Theken-Übersicht (`ThekePage`) um. Damit die Umschaltung schon unmittelbar nach dem Login greift, liefern sowohl `/auth/login` als auch `/auth/me` das vollständige `PublicMember`-Objekt (inkl. `can_book_for_others`, ohne `password_hash`).
- **Wirtschaftskommission & Streichen (`is_wirtschaftskommission`, `struck_until`)** — die WK ist ein Capability-Flag auf `members` (wie `can_book_for_others`), kein neuer `role`-Wert: die `role`-CHECK-Constraint via Table-Rebuild zu erweitern wäre wegen der `ON DELETE RESTRICT`-Fremdschlüssel auf `members` (`bookings.member_id`, `zeiger.created_by`) im Migrations-Runner nicht gefahrlos. Streichen dürfen WK **und** Admin (`requireWkOrAdmin`; das JWT trägt `is_wk`, frisch aus der DB wie die Rolle). Eine Streichung ist ein Zeitstempel `struck_until` (jetzt + 14 Tage); ein Zeitpunkt in der Vergangenheit gilt als abgelaufen — die Buchsperre ist eine reine Zeitvergleich-Prüfung ohne Cron. Blockiert werden nur Personenbuchungen (Selbst- + Theken-Buchung → 409 `MEMBER_STRUCK`); Zeiger-Buchungen laufen auf die Vereinskasse und bleiben erlaubt.
- **Profilbilder im Dateisystem** — Avatare liegen unter `AVATAR_DIR` (Dev: `./data/avatars`, Prod: `/var/lib/getraenke/avatars/`), die DB hält nur den Dateinamen. Upload via `multer` → Normalisierung durch `sharp` (256×256, WebP, Q85). Auslieferung über `GET /avatars/:file` (express.static). Das Verzeichnis muss ins Deployment-Backup aufgenommen werden.

## API-Übersicht

Basis-URL: `/api/v1`. Alle geschützten Endpunkte erwarten `Authorization: Bearer <jwt>`.

### Auth

| Methode | Pfad              | Auth | Beschreibung                                      |
| ------- | ----------------- | ---- | ------------------------------------------------- |
| POST    | `/auth/login`     | —    | Login mit Username + Passwort                     |
| POST    | `/auth/logout`    | User | Token serverseitig invalidieren                   |
| GET     | `/auth/me`        | User | Aktuelles Profil (vollständiges `PublicMember`)   |
| PATCH   | `/auth/me`        | User | Eigenen Anzeigenamen, E-Mail oder Passwort ändern |
| POST    | `/auth/me/avatar` | User | Profilbild hochladen (max 5 MB → 256×256 WebP)    |
| DELETE  | `/auth/me/avatar` | User | Profilbild entfernen                              |

### Mitglieder

| Methode | Pfad                    | Auth     | Beschreibung                                                       |
| ------- | ----------------------- | -------- | ------------------------------------------------------------------ |
| GET     | `/members`              | Admin    | Alle Mitglieder                                                    |
| POST    | `/members`              | Admin    | Neues Mitglied anlegen (inkl. `is_wirtschaftskommission`)          |
| GET     | `/members/bookable`     | User     | Bebuchbare Mitglieder (nur Konten mit `can_book_for_others`)       |
| GET     | `/members/strikeable`   | WK/Admin | Streichbare Personen-Konten inkl. bereits gestrichener             |
| GET     | `/members/:id`          | Admin    | Einzelnes Mitglied                                                 |
| PATCH   | `/members/:id`          | Admin    | Mitglied aktualisieren (inkl. `email`, `is_wirtschaftskommission`) |
| POST    | `/members/:id/avatar`   | Admin    | Profilbild eines Mitglieds setzen (max 5 MB → 256×256 WebP)        |
| DELETE  | `/members/:id/avatar`   | Admin    | Profilbild eines Mitglieds entfernen                               |
| POST    | `/members/:id/strike`   | WK/Admin | Konto für 2 Wochen streichen (keine Buchungen)                     |
| POST    | `/members/:id/unstrike` | WK/Admin | Konto vorzeitig entstreichen                                       |
| DELETE  | `/members/:id`          | Admin    | Mitglied deaktivieren (soft)                                       |

### Getränke

| Methode | Pfad                 | Auth  | Beschreibung             |
| ------- | -------------------- | ----- | ------------------------ |
| GET     | `/drinks`            | User  | Aktive Getränke + Preise |
| POST    | `/drinks`            | Admin | Neues Getränk anlegen    |
| PATCH   | `/drinks/:id`        | Admin | Getränk aktualisieren    |
| POST    | `/drinks/:id/prices` | Admin | Neuen Preis setzen       |

### Buchungen

| Methode | Pfad                   | Auth  | Beschreibung                                                                   |
| ------- | ---------------------- | ----- | ------------------------------------------------------------------------------ |
| POST    | `/bookings`            | User  | Buchung anlegen; optional `member_id` (nur Konten mit `can_book_for_others`)   |
| GET     | `/bookings/me`         | User  | Eigene Buchungen (paginiert)                                                   |
| GET     | `/bookings/member/:id` | User  | Buchungen eines Mitglieds; fremde nur mit `can_book_for_others`                |
| POST    | `/bookings/:id/void`   | User  | Eigene Buchung stornieren (≤ 5min); Allgemein-Konto auch eigene Fremdbuchungen |
| GET     | `/bookings`            | Admin | Alle Buchungen mit Filter                                                      |

### Reports (alle Admin-only, `format=csv|pdf`)

| Methode | Pfad                                                    | Beschreibung                          |
| ------- | ------------------------------------------------------- | ------------------------------------- |
| GET     | `/reports/monthly?memberId=&year=YYYY&month=MM&format=` | Monatsabrechnung eines Mitglieds      |
| GET     | `/reports/all?year=YYYY&month=MM`                       | Sammel-PDF aller aktiven Mitglieder   |
| GET     | `/reports/zeiger?from=&to=&format=`                     | Übersicht aller Zeiger im Zeitraum    |
| GET     | `/reports/zeiger/:id?format=`                           | Detailbericht eines einzelnen Zeigers |

### Zeiger & Verbindungen

| Methode | Pfad                   | Auth  | Beschreibung                                   |
| ------- | ---------------------- | ----- | ---------------------------------------------- |
| GET     | `/verbindungen`        | User  | Verbindungen (Dropdown); `?includeInactive`    |
| POST    | `/verbindungen`        | Admin | Verbindung anlegen                             |
| PATCH   | `/verbindungen/:id`    | Admin | Verbindung aktualisieren                       |
| DELETE  | `/verbindungen/:id`    | Admin | Verbindung deaktivieren (soft)                 |
| POST    | `/zeiger`              | User  | Zeiger (Besuch/Veranstaltung) eröffnen         |
| GET     | `/zeiger`              | User  | Zeiger auflisten; `?status=offen\|geschlossen` |
| GET     | `/zeiger/:id`          | User  | Einzelnen Zeiger lesen                         |
| PATCH   | `/zeiger/:id`          | User  | BBr-/Gäste-Zahlen aktualisieren (nur offen)    |
| GET     | `/zeiger/:id/bookings` | User  | Buchungen eines Zeigers                        |
| POST    | `/zeiger/:id/close`    | User  | Zeiger schließen                               |

### Update (M14, alle Admin-only)

| Methode | Pfad             | Beschreibung                                                                  |
| ------- | ---------------- | ----------------------------------------------------------------------------- |
| GET     | `/update/status` | Zuletzt vom Pi-Helper geschriebener Status (Version, Ergebnis, `in_progress`) |
| POST    | `/update`        | Schreibt Marker `"update"` → 202; 409 `UPDATE_IN_PROGRESS` wenn bereits offen |
| POST    | `/update/check`  | Schreibt Marker `"check"` (nur Prüfung, keine Installation) → 202             |

Keine dieser Routen löst ein Update selbst aus oder spricht mit GitHub — Details siehe „Auto-Update & Privilege-Separation" unten.

## Auth-Flow

1. Frontend POSTet Credentials an `/auth/login`.
2. Backend prüft `password_hash` per `bcrypt.compare` (timing-stabil auch bei unbekanntem User), generiert JWT (HS256, 8 h Gültigkeit, Payload: `{ sub, username, role, jti }`).
3. Frontend speichert Token in `localStorage` (akzeptabel im internen Vereins-WLAN; Trade-off bewusst gegenüber Session-Cookies).
4. `authenticate`-Middleware verifiziert die Signatur, prüft die Token-Blocklist **und lädt das Mitglied frisch aus der DB** (`AuthService.verifyActiveMember`): ist es deaktiviert oder gelöscht, wird sofort 401 geliefert; die Rolle wird immer aus der DB übernommen, sodass ein Rollenentzug nicht bis zum Token-Ablauf wartet.
5. `requireRole('admin')`-Middleware schützt Admin-Endpunkte.
6. **Logout** setzt die `jti` auf die Blocklist; **Passwortänderung** über `PATCH /auth/me` erfordert das aktuelle Passwort (`current_password`).

## Sicherheitsannahmen

- **Vertrauenswürdiges Netz**: Nur im Vereins-WLAN erreichbar. Trotzdem: HTTPS via selbstsigniertes Zertifikat oder Caddy-Reverse-Proxy empfohlen.
- **Security-Header**: `helmet` setzt u. a. eine strikte Content-Security-Policy (`script-src 'self'`; Webfonts von Google zugelassen). `upgrade-insecure-requests` ist bewusst deaktiviert, weil der Pi im WLAN oft nur über HTTP läuft.
- **Reverse-Proxy**: `TRUST_PROXY` (Default 0) gibt die Anzahl vertrauenswürdiger Proxy-Hops an; hinter Caddy/nginx auf `1` setzen, damit das Rate-Limiting die echte Client-IP sieht.
- **Brute-Force-Schutz**: Rate-Limiting auf `/auth/login` (5 Versuche / 15 Min / IP). Deaktivierbar nur über `DISABLE_RATE_LIMIT=true` (für E2E); ist das Flag in Produktion gesetzt, warnt der Start laut.
- **Input-Validierung**: Zod-Schemas auf jedem Endpoint.
- **SQL-Injection**: Ausschließlich Prepared Statements (von better-sqlite3 erzwungen).
- **CSV-Export**: Zellen, die mit `= + - @` beginnen, werden neutralisiert (Schutz vor Formel-Injektion in Excel/LibreOffice).
- **Profilbilder öffentlich**: `GET /avatars/:file` liegt bewusst **vor** der Auth-Middleware und ist damit ohne Login abrufbar. Im vertrauenswürdigen WLAN akzeptierter Trade-off (Bilder sind nicht sensibel, spart einen Blob-Fetch mit Token im Frontend).
- **Backups**: Cron-Job kopiert SQLite-DB täglich nach `/var/backups/getraenke/`; das `AVATAR_DIR` gehört ebenfalls ins Backup.

## Auto-Update & Privilege-Separation (M14)

Die App aktualisiert sich alle zwei Wochen selbst auf das neueste stabile
GitHub-Release; Admins können das im UI („System"-Bereich) auch manuell
anstoßen oder nur prüfen lassen. Vollständige Architektur, Störungssuche und
Installationsschritte stehen in [`docs/AUTO-UPDATE.md`](docs/AUTO-UPDATE.md)
— hier nur der sicherheitsrelevante Kern:

- **Der App-Prozess bleibt unprivilegiert.** `getraenke.service` läuft weiter
  gehärtet (`NoNewPrivileges=true`, `ProtectSystem=strict`, kein sudo, siehe
  `scripts/getraenke.service`) und macht **keinen** eigenen Netzabruf zu
  GitHub. Ein Admin-Klick auf „Jetzt aktualisieren"/„Jetzt prüfen" führt
  lediglich dazu, dass `UpdateService` (`backend/src/services/UpdateService.ts`)
  eine harmlose Marker-Datei (`update-requested`, Inhalt nur `"update"` oder
  `"check"` — nie ein Kommando oder eine Versionsangabe) in sein eigenes,
  ohnehin beschreibbares `StateDirectory` schreibt.
- **Eine separate, root-betriebene systemd-Infrastruktur übernimmt den Rest.**
  `getraenke-update.path` (auf dem Pi installiert, von systemd verwaltet)
  beobachtet exakt diese Marker-Datei und startet bei ihrem Erscheinen
  `getraenke-update.service` (läuft als root). `getraenke-update.timer` löst
  dieselbe Unit unabhängig davon alle zwei Wochen aus. Erst dieser
  privilegierte Helper (`scripts/pi-self-update.sh`) fragt die GitHub-API nach
  dem neuesten stabilen Release, lädt bei Bedarf das (tokenauthentifizierte)
  Release-Asset und installiert es über `scripts/pi-release.sh` — dasselbe
  Skript, das auch der reguläre Tag-Deploy nutzt (Backup, atomarer
  Symlink-Swap, Migrationen, Smoke-Test, automatischer Rollback bei Fehlern).
- **Status-Rückkanal nur über Datei.** Der Helper schreibt nach jedem Lauf
  `update-status.json` (aktuelle/verfügbare Version, Zeitpunkt, Ergebnis,
  Auslöser) in dasselbe Verzeichnis. `GET /update/status` liest ausschließlich
  diese Datei — die App erfährt die verfügbare Version, ohne selbst online zu
  gehen.
- **`UPDATE_STATE_DIR`** (ENV, Dev: `./data`, Prod: `/var/lib/getraenke`) muss
  mit dem `StateDirectory` des Pi-Helpers übereinstimmen, sonst sieht die App
  nie einen Status und der Helper nie einen Marker.
- **Token-Scope**: Das GitHub-Token liegt nur unter `/etc/getraenke/update.env`
  (root-only lesbar) für `getraenke-update.service` — niemals im
  `getraenke`-App-Prozess.

## Verzeichnisstruktur (Detail)

```
backend/
├── src/
│   ├── routes/           # Route-Definitionen pro Ressource (enthalten die Handler)
│   ├── middleware/       # authenticate, requireRole, errorHandler
│   ├── services/         # Geschäftslogik (Auth, Members, Booking, Report, Zeiger, …)
│   ├── db/
│   │   ├── client.ts     # better-sqlite3-Verbindung (WAL, FK, busy_timeout)
│   │   ├── migrate.ts    # Migrations-Runner
│   │   ├── repos/        # Datenzugriff pro Tabelle
│   │   └── migrations/   # Versionierte SQL-Migrationen
│   ├── schemas/          # Zod-Schemas
│   ├── formatters/       # CSV-/PDF-Erzeugung für Reports
│   ├── utils/            # env, logger
│   ├── app.ts            # Express-Setup (Wiring)
│   └── server.ts         # Entry-Point
├── tests/
│   ├── unit/
│   └── integration/
├── tsconfig.json
└── package.json

frontend/
├── src/
│   ├── components/       # Wiederverwendbare UI-Komponenten
│   ├── pages/            # Routen-Komponenten (inkl. admin/)
│   ├── api/              # API-Client (fetch-Wrapper) pro Ressource
│   ├── contexts/         # AuthContext, ToastContext
│   ├── styles/           # Design-Tokens
│   ├── App.tsx
│   └── main.tsx
├── tests/                # Vitest-Komponententests
├── tsconfig.json
└── vite.config.ts

e2e/                      # Playwright-Specs (eigener Workspace, Repo-Root)
```

## Build- und Run-Strategie

| Umgebung    | Backend                                          | Frontend                        |
| ----------- | ------------------------------------------------ | ------------------------------- |
| Development | `tsx watch src/server.ts` (kein Build-Step)      | `vite` Dev-Server mit HMR       |
| Production  | `tsc` → `dist/`, Start mit `node dist/server.js` | `vite build` → statische Assets |

Im Pi-Deployment liefert das Backend die `frontend/dist/`-Assets statisch aus, sodass nur ein Port exponiert werden muss (siehe Übersicht).
