# Hängt! - Jeder Strich zählt!

Lokale Web-App zur Getränkeabrechnung einer Verbindung. Mitglieder buchen ihre Getränke per Self-Service, Admins verwalten Stammdaten und exportieren Monatsabrechnungen als PDF oder CSV. Die Anwendung läuft auf einem Raspberry Pi im Vereins-WLAN — keine Cloud, keine externen Abhängigkeiten zur Laufzeit.

## Features

- 🔐 Login für Mitglieder (PIN oder Passwort)
- 🍺 Schnelle Getränkebuchung mit Tap-Bedienung (mobilfreundlich), nach Kategorien geclustert
- 👤 Admin-Bereich für Mitglieder-, Getränke-, Kategorie- und Preisverwaltung
- 🚫 Wirtschaftskommission: Konten streichen (2 Wochen keine Buchungen) & vorzeitig entstreichen
- 📊 Monatsabrechnung pro Mitglied als PDF und CSV
- 📈 Verbrauchs-Auswertung (Anzahl & Umsatz je Getränk) für frei wählbare Zeiträume
- 📜 Buchungshistorie & Stornierung innerhalb eines Zeitfensters
- 📱 Responsive UI (Tablet, Smartphone, Desktop)
- 🔄 Automatische App-Updates alle zwei Wochen (neuestes stabiles Release), von Admins im System-Bereich auch manuell anstoßbar

## Tech-Stack

| Bereich   | Technologie                         |
| --------- | ----------------------------------- |
| Backend   | Node.js 20 LTS, Express             |
| Datenbank | SQLite (better-sqlite3)             |
| Frontend  | React 18, Vite, TailwindCSS         |
| Auth      | JWT + bcrypt                        |
| Tests     | Vitest, Supertest, Playwright       |
| Linting   | ESLint, Prettier                    |
| CI/CD     | GitHub Actions (Self-Hosted Runner) |
| Hosting   | Raspberry Pi 4/5, systemd           |

## Projektstruktur

```
getraenkeabrechnung/
├── backend/        # Express API + SQLite
├── frontend/       # React App (Vite)
├── docs/           # Architektur- und Meilenstein-Doku
├── scripts/        # Deploy- und Wartungsskripte
└── .github/        # CI/CD-Workflows
```

## Voraussetzungen

- Node.js ≥ 20.x
- npm ≥ 10.x
- Git
- (Für Deployment) Raspberry Pi 4/5 mit Raspberry Pi OS 64-bit

## Lokales Setup

```bash
# 1. Repository klonen
git clone https://github.com/gesellc90/haengt.git
cd haengt

# 2. Dependencies installieren (Backend & Frontend)
npm run install:all

# 3. Environment-Datei anlegen
cp backend/.env.example backend/.env
# JWT_SECRET, PORT etc. anpassen

# 4. Datenbank initialisieren & Seed-Daten laden
npm run db:migrate --workspace=backend
npm run db:seed --workspace=backend

# 5. Entwicklungsserver starten (Backend + Frontend parallel)
npm run dev
```

Backend läuft anschließend unter `http://localhost:3001`, Frontend unter `http://localhost:5173`.

### Standard-Logindaten (Seed)

Der Seed legt die Mitglieder `admin`, `anna`, `bernd`, das Theken-Konto
`allgemein` und das Wirtschaftskommissions-Konto `wiko` an. In der
Entwicklungsumgebung (`NODE_ENV=development`) setzt der Seed automatisch ein
Passwort für den Admin **und** das WK-Konto:

| Rolle                 | Benutzer | Passwort   |
| --------------------- | -------- | ---------- |
| Admin                 | `admin`  | `admin123` |
| Wirtschaftskommission | `wiko`   | `wiko123`  |

Die übrigen Mitglieder haben zunächst **kein** Passwort — ein Admin vergibt es
über die Mitgliederverwaltung. (Die E2E-Suite setzt eigene Test-Passwörter,
siehe [`docs/TESTING.md`](docs/TESTING.md).)

> ⚠️ Vor dem Produktiv-Deployment das Admin-Passwort **unbedingt** ändern.

## Häufige Skripte

| Befehl               | Beschreibung                     |
| -------------------- | -------------------------------- |
| `npm run dev`        | Backend + Frontend im Watch-Mode |
| `npm run lint`       | ESLint über das gesamte Projekt  |
| `npm test`           | Unit- und Integrationstests      |
| `npm run test:e2e`   | Playwright E2E-Tests             |
| `npm run build`      | Production-Build des Frontends   |
| `npm run db:migrate` | Datenbankmigrationen ausführen   |
| `npm run deploy:pi`  | Deployment auf den Raspberry Pi  |

## Deployment

Siehe [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). Kurzfassung: GitHub Actions baut auf dem Self-Hosted Runner (Raspberry Pi), legt das Build-Artefakt nach `/opt/getraenke/` ab und startet den `getraenke.service` (systemd) neu.

## Mitarbeit

Beiträge sind willkommen — siehe [CONTRIBUTING.md](CONTRIBUTING.md).

## Lizenz

MIT
