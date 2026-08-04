# Automatisches App-Update (M14)

Der Raspberry Pi aktualisiert die App **automatisch alle zwei Wochen** auf
das neueste stabile Release. Zusätzlich kann ein **Admin das Update
jederzeit im Admin-Bereich manuell anstoßen** oder nur prüfen lassen, ob
eines verfügbar ist. Aktualisiert wird **nur die App** (Frontend + Backend)
— das Betriebssystem des Pi bleibt separat gepflegt (siehe
[`RASPBERRY-PI-SETUP.md`](./RASPBERRY-PI-SETUP.md), Abschnitt
„Automatische Security-Updates").

## Architektur

```
                    alle 2 Wochen
getraenke-update.timer ───────────────┐
                                       ▼
Admin-Bereich (App)          getraenke-update.service   scripts/pi-self-update.sh
  schreibt Marker-Datei  ──▶  (läuft als root)      ──▶   ├─ fragt GitHub-Release ab
  "update" | "check"          getraenke-update.path        ├─ vergleicht Version
  in StateDirectory            beobachtet die Marker-Datei  ├─ lädt Tarball (falls nötig)
                                                             └─ ruft pi-release.sh auf
                                                                  (Backup, Swap, Migration,
                                                                   Restart, Smoke-Test,
                                                                   Rollback bei Fehler)
```

## Privilege-Separation

Der App-Dienst `getraenke.service` läuft bewusst **stark eingeschränkt**
(`NoNewPrivileges=true`, `ProtectSystem=strict`, kein `sudo`, siehe
Kommentar-Header in `scripts/getraenke.service`). Das Update selbst braucht
aber privilegierte Aktionen: `systemctl restart`, Migrationen als App-User
`getraenke`, und den Download eines privaten Release-Assets mit einem
GitHub-Token. Diese Rechte bekommt **nicht** der App-Prozess, sondern eine
separate systemd-Infrastruktur:

- **App-Prozess (`getraenke`-User):** schreibt bei einer Admin-Aktion nur
  eine harmlose Textdatei `/var/lib/getraenke/update-requested` mit dem
  Inhalt `update` oder `check` in sein eigenes, ohnehin beschreibbares
  `StateDirectory`. Kein sudo, kein Netzabruf zu GitHub, kein Zugriff auf
  `/etc/getraenke/update.env` (das GitHub-Token).
- **`getraenke-update.path` (systemd, root-verwaltet):** beobachtet exakt
  diese eine Datei (`PathExists=`) und startet bei ihrem Erscheinen
  `getraenke-update.service`. Das ist die einzige Brücke von
  unprivilegiert zu privilegiert — sie wird von systemd selbst betrieben,
  nicht vom App-Prozess.
- **`getraenke-update.service` (läuft als root):** führt
  `scripts/pi-self-update.sh` aus. Root kann `systemctl restart` ohne
  zusätzliche sudoers-Regeln aufrufen, unter jedem beliebigen User
  ausführen (für die Migrationen als `getraenke`) und
  `/etc/getraenke/update.env` lesen.
- **`getraenke-update.timer`:** startet dieselbe Unit unabhängig vom
  Marker alle zwei Wochen — ohne Marker läuft `pi-self-update.sh` im
  Default-Modus `update` (voller Lauf, nicht nur Prüfung).

**Der Marker enthält absichtlich keine Versionsangabe und kein Kommando** —
er wählt nur zwischen zwei fest verdrahteten, ungefährlichen Codepfaden
(„nur prüfen" vs. „aktualisieren"). Welche Version installiert wird
(„neuestes stabiles Release"), bestimmt ausschließlich
`pi-self-update.sh` selbst — der App-Prozess kann weder ein Downgrade noch
eine beliebige fremde Version erzwingen.

## Status-Rückkanal

Nach jedem Lauf (Timer **oder** Marker-Trigger) schreibt
`pi-self-update.sh` `/var/lib/getraenke/update-status.json`:

```json
{
  "current_version": "v0.5.0",
  "available_version": "v0.6.0",
  "last_checked_at": "2026-07-22T03:30:04Z",
  "last_result": "update_available",
  "last_trigger": "timer",
  "in_progress": false
}
```

`last_result` ist eines von: `up_to_date`, `update_available`,
`in_progress`, `success`, `failed`. Die App liest **ausschließlich diese
Datei** (kein eigener GitHub-Zugriff) — siehe Backend-Route
`GET /admin/update/status` (M14 PR 3).

## Release-Ziel: neuestes stabiles Tag

`pi-self-update.sh` fragt `GET /repos/<owner>/<repo>/releases/latest` ab
— das ist per GitHub-API-Definition das neueste **nicht** als Pre-Release
markierte, veröffentlichte Release. Der `deploy.yml`-Workflow hängt bei
jedem Tag-Push (`v*.*.*`) den Release-Tarball als Asset an genau dieses
Release an (`softprops/action-gh-release`). Es wird **nie** ein
ungetesteter `main`-Zwischenstand installiert.

## Token-Scope

Da das Repository privat ist, braucht der Helper ein
Fine-Grained-Personal-Access-Token mit **ausschließlich** der Berechtigung
„Contents: Read-only" für genau dieses Repository (`/etc/getraenke/update.env`,
Mode `0600`, `root:root` — siehe `scripts/update.env.example`). Das Token
ist **nie** im `getraenke`-App-Prozess lesbar, nur für
`getraenke-update.service` (root).

## Manuelles Prüfen / Anstoßen

Über den Admin-Bereich der App (Buttons „Jetzt prüfen" / „Jetzt
aktualisieren", M14 PR 4) oder direkt auf dem Pi:

```bash
# Marker manuell setzen (z. B. zum Testen ohne UI):
echo -n "check" | sudo tee /var/lib/getraenke/update-requested
# oder:
echo -n "update" | sudo tee /var/lib/getraenke/update-requested

# Unit direkt starten (ignoriert den Marker-Mechanismus, läuft im
# Timer-Default „update"):
sudo systemctl start getraenke-update.service
```

## Störungssuche

```bash
# Logs des letzten Laufs
sudo journalctl -u getraenke-update -n 100 --no-pager

# Live mitverfolgen
sudo journalctl -u getraenke-update -f

# Aktueller Status
cat /var/lib/getraenke/update-status.json | jq .

# Timer-Zeitplan prüfen
systemctl list-timers getraenke-update.timer

# Path-Unit aktiv?
systemctl status getraenke-update.path
```

| Symptom                                              | Wahrscheinliche Ursache                                 | Fix                                                                          |
| ----------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `update-status.json` fehlt dauerhaft                | Timer/Path-Unit nicht aktiviert                          | `sudo systemctl enable --now getraenke-update.path getraenke-update.timer`  |
| `last_result: "failed"`, kein Update installiert      | GitHub-API/Token-Problem oder Netzwerk                   | `sudo journalctl -u getraenke-update` prüfen, `update.env` kontrollieren    |
| `last_result: "failed"` nach Symlink-Swap             | Restart/Smoke-Test fehlgeschlagen — `pi-release.sh` hat bereits automatisch zurückgerollt | App läuft weiter auf altem Stand; Root-Ursache im Journal des neuen Release prüfen |
| Marker-Datei bleibt liegen, nichts passiert            | `getraenke-update.path` nicht aktiv/enabled               | `systemctl status getraenke-update.path`, ggf. `daemon-reload` + `enable --now` |
| „GITHUB_TOKEN fehlt" im Log                            | `/etc/getraenke/update.env` fehlt oder unvollständig      | Schritt 10 in `RASPBERRY-PI-SETUP.md` erneut ausführen                      |

## Verwandte Dokumente

- [`DEPLOYMENT.md`](./DEPLOYMENT.md) — Tag-Deploy, auf dem `pi-release.sh`
  ebenfalls aufbaut.
- [`RASPBERRY-PI-SETUP.md`](./RASPBERRY-PI-SETUP.md) — Installation der
  Units (Schritt 10).
- [`MILESTONES.md`](../MILESTONES.md), M14 — vollständige Planung inkl.
  Backend-/Frontend-PRs.
