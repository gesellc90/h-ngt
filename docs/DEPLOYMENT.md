# Deployment

Dieses Dokument beschreibt, wie die App auf den Vereins-Raspberry-Pi
deployed wird. Es deckt aktuell die **systemd-Service-Unit** (PR 1) und den
**automatisierten Deploy-Workflow** (PR 2) ab. Die Pi-Grundeinrichtung (PR 4)
folgt in einem separaten Patch.

## Verzeichnis-Layout auf dem Pi

```
/opt/getraenke/
├── current                  → Symlink auf das aktive Release
└── releases/
    ├── v0.1.0/              # Erstes Release
    │   ├── backend/dist/    # tsc-Output (Backend)
    │   ├── backend/node_modules/   # production-only (npm ci --omit=dev)
    │   ├── backend/package.json
    │   ├── frontend/dist/   # vite-Build (Frontend)
    │   └── …
    └── v0.1.1/              # Nächstes Release (atomarer Symlink-Swap)

/etc/getraenke/
└── env                      # EnvironmentFile (Mode 0640, root:getraenke)

/var/lib/getraenke/          # StateDirectory (vom Service-User beschreibbar)
├── getraenke.db             # SQLite-DB
└── avatars/                 # Profilbilder (256×256 WebP, ein <id>.webp je Mitglied)

/var/backups/getraenke/      # Backups (vom Deploy-Skript beschrieben)
└── v0.1.0-20260514T080000Z.sqlite
```

**Warum dieses Layout?** `/opt` für Drittsoftware, `/var/lib` für
veränderliche Daten, `/etc` für Konfiguration — FHS-konform. systemd legt
`/var/lib/getraenke` automatisch via `StateDirectory=getraenke` an, sodass
die Pi-Grundeinrichtung nur die anderen Verzeichnisse erstellen muss.

**Profilbilder** liegen unterhalb desselben `StateDirectory` im Unterordner
`avatars/` (ENV `AVATAR_DIR=/var/lib/getraenke/avatars`). Das Verzeichnis wird
von der App beim ersten Upload automatisch angelegt und ist durch
`StateDirectory=getraenke` bereits vom Service-User beschreibbar — es sind
keine zusätzlichen `install`-Schritte nötig. Da die Bilder **nicht** in der
SQLite-DB liegen (die DB hält nur den Dateinamen in `members.avatar_path`),
deckt das reine DB-Backup sie nicht ab — siehe Backup-Hinweis unten.

## Service-Account

Die App läuft als unprivilegierter Systembenutzer `getraenke`:

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin getraenke
```

Dieser User hat **keinen Login-Shell** und **kein Home-Verzeichnis** —
das passt zur `ProtectHome=true`-Direktive in der Unit.

## EnvironmentFile

Datei `/etc/getraenke/env` mit folgendem Inhalt (Beispiel):

```bash
# /etc/getraenke/env – wird von systemd in den Prozess injiziert.
# Mode 0640, owner root:getraenke.
NODE_ENV=production
PORT=3001
LOG_LEVEL=info

# Pfad zur SQLite-Datei. Muss innerhalb des StateDirectory liegen,
# da systemd alles andere read-only macht (ProtectSystem=strict).
DB_PATH=/var/lib/getraenke/getraenke.db

# Verzeichnis für Profilbilder. Ebenfalls im StateDirectory, sonst
# schlägt der Upload wegen ProtectSystem=strict fehl.
AVATAR_DIR=/var/lib/getraenke/avatars

# Rückkanal zum Auto-Update-Helper (M14): Statusdatei lesen, Marker-Datei
# schreiben. MUSS mit dem StateDirectory des Helpers übereinstimmen, sonst
# sieht die App nie einen Status und der Helper nie einen Marker.
UPDATE_STATE_DIR=/var/lib/getraenke

# JWT-Secret: mindestens 32 Zeichen, kryptografisch zufällig.
# Erzeugen z. B. mit:  openssl rand -hex 48
JWT_SECRET=<HIER 32+ zufällige Zeichen einsetzen, NIE committen!>
JWT_EXPIRES_IN=8h
```

Berechtigungen setzen:

```bash
sudo install -d -m 0750 -o root -g getraenke /etc/getraenke
sudo install -m 0640 -o root -g getraenke /dev/stdin /etc/getraenke/env <<'EOF'
NODE_ENV=production
PORT=3001
LOG_LEVEL=info
DB_PATH=/var/lib/getraenke/getraenke.db
AVATAR_DIR=/var/lib/getraenke/avatars
UPDATE_STATE_DIR=/var/lib/getraenke
JWT_SECRET=<bitte ersetzen>
JWT_EXPIRES_IN=8h
EOF
```

> **Hinweis zur Bind-Adresse:** Express bindet aktuell ohne `host`-Parameter,
> d. h. auf `0.0.0.0` — die App ist im Vereins-WLAN über
> `http://<pi-ip>:3001` erreichbar. Falls später ein Reverse-Proxy
> (Caddy/nginx) davor kommt, kann die App auf `127.0.0.1` umgestellt werden
> (erfordert kleine Anpassung in `backend/src/server.ts`).

## Runner-User und sudoers

Der GitHub-Actions-Self-Hosted-Runner läuft als **eigener User** (nicht als
`getraenke`), damit Deploy-Operationen klar vom App-User getrennt sind:

```bash
# Runner-User anlegen (Mitglied der Gruppe getraenke → kann ENV-File lesen
# und DB für Backup mounten).
sudo useradd --system --create-home --groups getraenke --shell /bin/bash getraenke-runner

# Verzeichnis-Eigentum: Runner darf Release-Dir und Backup-Dir schreiben,
# Gruppe getraenke darf lesen.
sudo install -d -m 0775 -o getraenke-runner -g getraenke /opt/getraenke
sudo install -d -m 0775 -o getraenke-runner -g getraenke /opt/getraenke/releases
sudo install -d -m 0775 -o getraenke-runner -g getraenke /var/backups/getraenke
```

Der Runner braucht **NOPASSWD-sudo** für genau drei Befehle:

- `systemctl restart getraenke.service`
- `systemctl status getraenke.service`
- DB-Migration als App-User `getraenke` (`sudo -u getraenke … migrate-cli.js`)

Die Datei `scripts/getraenke-deploy.sudoers` enthält das passende Snippet —
keine Wildcards außerhalb des Tag-Anteils im Release-Pfad, kein freies `env`:

```bash
sudo install -m 0440 -o root -g root scripts/getraenke-deploy.sudoers \
    /etc/sudoers.d/getraenke-deploy
sudo visudo -cf /etc/sudoers.d/getraenke-deploy    # muss „parsed OK" sagen
```

## Service installieren

```bash
# Aus dem Repo-Checkout heraus:
sudo cp scripts/getraenke.service /etc/systemd/system/getraenke.service
sudo systemctl daemon-reload
sudo systemctl enable --now getraenke.service
```

## Service verifizieren

### Syntax und Härtung prüfen

```bash
# Syntax + Pfad-Auflösung (warnt bei ExecStart-Datei, die nicht existiert –
# das ist auf dem Build-Host normal, solange noch kein Release deployed ist).
sudo systemd-analyze verify scripts/getraenke.service

# Härtungs-Score – Ziel: < 3.0 („OK") oder besser.
sudo systemd-analyze security getraenke.service
```

`systemd-analyze security` zeigt detailliert, welche Sandbox-Direktiven gesetzt
sind und wo noch Lücken bestehen. Aktuelle Annahme: Wert liegt im
„OK"-Bereich (1.5–3.0), weil wir Capabilities, Namespaces und Syscalls
strikt einschränken.

### Liveness-Check

Der Backend-Smoke-Test läuft gegen `/api/v1/health`:

```bash
curl -fsS http://localhost:3001/api/v1/health
# {"status":"ok","uptime":12.34,"timestamp":"2026-05-14T08:00:00.000Z"}
```

Dieser Endpunkt wird im Deploy-Workflow (PR 2) für den Post-Deploy-Smoke-Test
verwendet.

### Logs lesen

```bash
# Live-Stream (pino-JSON):
sudo journalctl -u getraenke.service -f

# Hübsch formatieren (falls pino-pretty global installiert ist):
sudo journalctl -u getraenke.service -f -o cat | npx pino-pretty
```

## Häufige Probleme

| Symptom                                                   | Wahrscheinliche Ursache                  | Fix                                                          |
| --------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------ |
| `status=203/EXEC` beim Start                              | `/usr/bin/node` existiert nicht          | Node via NodeSource installieren (siehe Pi-Setup, PR 4)      |
| `Permission denied` auf DB                                | `DB_PATH` außerhalb von `StateDirectory` | Pfad muss unter `/var/lib/getraenke/` liegen                 |
| `JWT_SECRET muss mindestens 32 Zeichen`                   | EnvironmentFile zu kurz/leer             | `openssl rand -hex 48` und in `/etc/getraenke/env` eintragen |
| Service startet, aber `curl /health` → connection refused | `PORT` weicht von `3001` ab              | EnvironmentFile prüfen, Firewall (`ufw`) prüfen              |
| `Failed to set up StateDirectory`                         | systemd zu alt (< 235)                   | Pi OS Bookworm bringt systemd 252 — OK                       |

## Deploy-Workflow

Ein Release wird durch das Pushen eines SemVer-Tags ausgelöst:

```bash
# CHANGELOG.md aktualisieren, package.json-Versionen bumpen, dann:
git tag -a v0.1.0 -m "Release 0.1.0"
git push origin v0.1.0
```

`.github/workflows/deploy.yml` reagiert auf `v*.*.*`-Tags und durchläuft zwei
Jobs:

1. **`build` auf `ubuntu-latest`** — `npm ci`, `npm run build` für Backend
   (`tsc`) und Frontend (`vite`). Das Tarball enthält nur `*/dist/`, die
   Package-Manifests, `scripts/deploy-migrate.sh` und `scripts/pi-release.sh`
   — KEINE `node_modules`, weil `better-sqlite3` auf dem Pi nativ für ARM
   kompiliert werden muss. Der Tarball wird zusätzlich als **GitHub-Release-
   Asset** an das Tag angehängt (dauerhaft abrufbar, unabhängig von der
   30-Tage-Actions-Artefakt-Retention) — Voraussetzung für den geplanten
   Auto-Update-Helper auf dem Pi (siehe `MILESTONES.md`, M14).
2. **`deploy` auf `[self-hosted, raspberry-pi]`** — lädt das Artefakt herunter
   und ruft `scripts/pi-release.sh <tarball> <tag>` auf. Das Skript kapselt
   die gesamte Release-Installation inkl. Rollback (Verhalten unverändert
   gegenüber früher, nur aus den Workflow-Steps in ein wiederverwendbares
   Skript gezogen — dasselbe Skript soll später auch der Auto-Update-Helper
   nutzen):
   1. _Snapshot:_ aktuelles Ziel von `current` merken (Rollback-Anker).
   2. _DB-Backup_ via `sqlite3 .backup` →
      `/var/backups/getraenke/<tag>-<utc-timestamp>.sqlite`.
      WAL-sicher; Service muss nicht gestoppt werden.
   3. _Tarball entpacken_ nach `/opt/getraenke/releases/<tag>/`.
   4. _`npm ci --omit=dev --workspace=backend`_ im Release-Dir — kompiliert
      `better-sqlite3` für ARM.
   5. _Migrationen_ via `scripts/deploy-migrate.sh`. Liest
      `/etc/getraenke/env` und ruft `migrate-cli.js` als App-User
      `getraenke` auf. Bei Fehler: Abbruch, alte App läuft weiter.
   6. _Symlink-Swap_ mit `ln -sfn` + `mv -Tf` (atomar auf Linux). Ab hier
      greift bei einem Fehler automatisch der Rollback (Trap im Skript).
   7. _Service-Restart_ via `sudo systemctl restart getraenke.service`,
      gefolgt von 5× `is-active`-Check à 2 s.
   8. _Smoke-Test_ `curl -fsS --max-time 10 http://localhost:3001/api/v1/health`,
      ebenfalls 5× retry.
   9. _Rollback_ (nur wenn Swap erfolgt war + ein späterer Schritt
      gescheitert ist): Symlink auf vorheriges Release zurück + erneuter
      Restart, Skript beendet sich trotzdem mit Fehlercode → Workflow wird
      rot abgeschlossen.
   10. _Aufbewahrung:_ ältere Releases als die letzten 5 werden gelöscht
       (das aktive Release wird nie gelöscht, auch wenn es theoretisch
       „raus" sortiert würde).

   Konfigurierbar über Umgebungsvariablen (`RELEASES_DIR`, `CURRENT_LINK`,
   `DB_PATH`, `BACKUP_DIR`, `HEALTH_URL`, `KEEP_RELEASES`) — siehe
   Kommentar-Header in `scripts/pi-release.sh`.

> **Backup-Hinweis (Profilbilder):** Das Deploy-DB-Backup (Schritt 2) sichert
> **nur** `getraenke.db`. Die Profilbilder unter `AVATAR_DIR`
> (`/var/lib/getraenke/avatars`) liegen im Dateisystem und werden davon
> **nicht** erfasst. Damit ein Restore vollständig ist, muss das Avatar-
> Verzeichnis vom regelmäßigen Datei-Backup mit abgedeckt werden — die
> Cron-Backup-Jobs aus [`RASPBERRY-PI-SETUP.md`](./RASPBERRY-PI-SETUP.md)
> sichern täglich DB **und** Avatar-Verzeichnis, sodass beide zusammen im
> Off-Site-`rsync` landen. Ein manuelles Avatar-Backup genügt z. B. mit:
>
> ```bash
> sudo tar czf /var/backups/getraenke/avatars-$(date -u +%Y%m%dT%H%M%SZ).tar.gz \
>     -C /var/lib/getraenke avatars
> ```

## Manueller Rollback

Wenn ein Deploy stumm Probleme erzeugt (Smoke-Test grün, aber Endnutzer
melden Fehler), kann jederzeit manuell zurückgerollt werden:

```bash
# Auf dem Pi:
ls -dt /opt/getraenke/releases/v*/        # neueste zuerst
# Beispiel: zurück auf v0.1.4
sudo -u getraenke-runner ln -sfn /opt/getraenke/releases/v0.1.4 /opt/getraenke/current.rollback
sudo -u getraenke-runner mv -Tf /opt/getraenke/current.rollback /opt/getraenke/current
sudo systemctl restart getraenke.service
curl -fsS http://localhost:3001/api/v1/health
```

> **Achtung:** ein manueller Rollback rollt **nur den Code** zurück. Die
> Datenbank bleibt auf dem Schema-Stand der neuesten Migration. Falls eine
> Migration nicht backward-compatible war, muss zusätzlich das DB-Backup aus
> `/var/backups/getraenke/<tag>-<ts>.sqlite` zurückgespielt werden:
>
> ```bash
> sudo systemctl stop getraenke.service
> sudo -u getraenke cp /var/backups/getraenke/<tag>-<ts>.sqlite \
>     /var/lib/getraenke/getraenke.db
> sudo systemctl start getraenke.service
> ```

## Bekannte Limitierungen

Diese Punkte sind aktuell **bewusst offen** — sie blockieren keinen
Initial-Deploy auf den Pi (App ist im Vereins-LAN über `http://<pi-ip>:3001`
nutzbar), würden für ein Single-Port-Setup mit Reverse-Proxy aber gebraucht
und sind als Folge-Issues zur Bearbeitung eingeplant.

### 1. `HOST` aus dem EnvironmentFile wird (noch) nicht respektiert

`backend/src/server.ts` ruft `app.listen(env.PORT, …)` ohne `host`-Parameter
auf — Express bindet damit auf `0.0.0.0`. Ein `HOST=127.0.0.1` in
`/etc/getraenke/env` hätte aktuell **keine Wirkung**.

**Was nötig wird, sobald Caddy/nginx davor kommt:**

- `backend/src/utils/env.ts`: `HOST: z.string().default('0.0.0.0')` ergänzen.
- `backend/src/server.ts`: `app.listen(env.PORT, env.HOST, …)`.
- Supertest-Integrationstest dafür (Endpoint binden + 127.0.0.1 erreichen).

Aufwand: ~30 Zeilen inkl. Test, eigener `feat(server)`-PR.

### 2. Frontend wird (noch) nicht vom Backend statisch ausgeliefert

`ARCHITECTURE.md` beschreibt: Express liefert `frontend/dist/` per
`express.static` aus, damit nur ein Port (`3001`) im Vereins-WLAN exponiert
wird. Aktuell macht der Code das **nicht** — Frontend-Assets sind im Release
unter `frontend/dist/`, werden aber nicht geserviced.

Solange Mitglieder die App über `http://<pi-ip>:3001/api/...` aufrufen würden,
fällt das nicht auf. Sobald sie aber die React-SPA selbst öffnen sollen,
braucht es entweder:

- **Variante A (empfohlen):** `backend/src/app.ts` um
  `app.use(express.static(path.resolve('../frontend/dist')))` plus
  SPA-Fallback (`app.get('*', (_, res) => res.sendFile(…))`) erweitern.
  Im Deploy-Workflow muss `frontend/dist/` im Tarball sein (ist es bereits).
- **Variante B:** Vite-Preview oder ein dedizierter statischer Server
  (Caddy/nginx) liefert das Frontend; die App bleibt API-only.

Aufwand Variante A: ~50–80 Zeilen + Tests, eigener `feat(server)`-PR.

## Weiterführende Doku

- [`RASPBERRY-PI-SETUP.md`](./RASPBERRY-PI-SETUP.md) — Pi-Grundeinrichtung (OS-Flash, Hardening, Node 20, User/Verzeichnis-Layout, Cron-Backup).
- [`RUNNER-SETUP.md`](./RUNNER-SETUP.md) — Registrierung des GitHub-Actions-Self-Hosted-Runners auf dem Pi.
- [`AUTO-UPDATE.md`](./AUTO-UPDATE.md) — Automatisches App-Update alle zwei Wochen + manueller Admin-Anstoß (M14): Architektur, Privilege-Separation, Störungssuche.
- [`TESTING.md`](./TESTING.md) — Test-Schichten, Playwright-E2E lokal ausführen, Trace-Viewer.
