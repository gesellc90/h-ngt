# Raspberry-Pi-Grundeinrichtung

Diese Anleitung führt einen frisch ausgepackten Raspberry Pi bis zu dem
Punkt, an dem die App via [GitHub Actions Self-Hosted Runner](./RUNNER-SETUP.md)
deployed werden kann. Die laufende App-Konfiguration (systemd-Unit, ENV-File,
Service-User) steht in [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## Referenz-Hardware

Die Doku ist auf folgenden Stand abgestimmt — abweichende Modelle laufen
prinzipiell auch, brauchen aber ggf. Anpassungen (z. B. armhf-Pakete bei Pi 3B+).

| Komponente | Empfehlung                                | Begründung                                                    |
| ---------- | ----------------------------------------- | ------------------------------------------------------------- |
| Modell     | Raspberry Pi 4 Model B, 4 GB RAM          | Bookworm-ARM64, genug RAM für Node + DB + Backup-Headroom     |
| Storage    | Industrial microSD-Karte (A2, ≥ 32 GB)    | Niedriges DB-Schreibvolumen (≈ 1000 Buchungen/Monat), günstig |
| OS         | Raspberry Pi OS Lite (64-bit, Bookworm)   | Kein Desktop nötig — wir liefern nur Headless HTTP            |
| Netzwerk   | Kabelgebunden im Vereins-LAN              | Stabiler als WLAN, Pi hängt am Switch                         |
| Spannung   | Original Pi-Netzteil (3 A USB-C bei Pi 4) | Unterspannung führt zu SD-Korruption                          |

## Schritt 1 — OS auf SD-Karte flashen

1. [Raspberry Pi Imager](https://www.raspberrypi.com/software/) öffnen.
2. **Pi-Modell:** Pi 4 → **OS:** „Raspberry Pi OS (other) → Raspberry Pi OS Lite (64-bit)" → **Storage:** die SD-Karte.
3. Zahnrad-Icon (Einstellungen) öffnen und vorab konfigurieren:
   - Hostname: `getraenke-pi` (oder eigener)
   - SSH aktivieren → **Public-Key-Authentifizierung**, deinen Public-Key
     einfügen (`cat ~/.ssh/id_ed25519.pub`)
   - Benutzer anlegen: `pi-admin` mit einem starken Passwort (wird gleich
     wieder eingeschränkt)
   - WLAN-Konfiguration leer lassen — wir verkabeln.
   - Locale: `de_DE.UTF-8`, Tastatur: `de`, Zeitzone: `Europe/Berlin`
4. SCHREIBEN. SD-Karte in den Pi stecken, mit LAN und Netzteil verbinden.

## Schritt 2 — Erster SSH-Login + System aktualisieren

```bash
ssh pi-admin@getraenke-pi.local      # oder per IP, falls mDNS nicht geht

# Pakete aktualisieren
sudo apt-get update
sudo apt-get full-upgrade -y
sudo reboot
```

## Schritt 3 — Production-Hardening

### 3.1 SSH absichern

Schon im Imager wurde Public-Key-Auth aktiviert. Jetzt zusätzlich:

```bash
sudo tee /etc/ssh/sshd_config.d/99-hardening.conf > /dev/null <<'EOF'
PasswordAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
ChallengeResponseAuthentication no
UsePAM yes
X11Forwarding no
PrintMotd no
ClientAliveInterval 300
ClientAliveCountMax 2
MaxAuthTries 3
LoginGraceTime 30
EOF

sudo systemctl restart ssh
```

> **Vorher prüfen, dass dein Public-Key wirklich akzeptiert wird** — sonst
> sperrst du dich aus! Test in einem **zweiten** Terminal:
> `ssh pi-admin@getraenke-pi.local` muss ohne Passwort funktionieren.

### 3.2 Firewall (ufw)

```bash
sudo apt-get install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp       comment 'SSH'
sudo ufw allow 3001/tcp     comment 'Getränke-App'
sudo ufw enable
sudo ufw status verbose
```

Falls du SSH später auf einen Nicht-Standard-Port legst, beide Ports
freigeben, bis du gegengetestet hast.

### 3.3 Brute-Force-Schutz (fail2ban)

```bash
sudo apt-get install -y fail2ban
sudo tee /etc/fail2ban/jail.d/sshd.conf > /dev/null <<'EOF'
[sshd]
enabled = true
port    = ssh
maxretry = 5
findtime = 10m
bantime  = 1h
EOF
sudo systemctl enable --now fail2ban
sudo fail2ban-client status sshd
```

### 3.4 Automatische Security-Updates

```bash
sudo apt-get install -y unattended-upgrades apt-listchanges
sudo dpkg-reconfigure -plow unattended-upgrades   # Y bei Nachfrage

# Update-Window konfigurieren (Sonntagnacht 03:00, automatischer Reboot wenn nötig)
sudo tee /etc/apt/apt.conf.d/52unattended-extras > /dev/null <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:00";
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF
```

### 3.5 Zeit-Synchronisation

```bash
# systemd-timesyncd ist standardmäßig aktiv — Status prüfen:
timedatectl status
# Falls "System clock synchronized: no" → manuell starten:
sudo systemctl enable --now systemd-timesyncd
```

## Schritt 4 — Anwendungsabhängigkeiten

### 4.1 Node.js 20 (via NodeSource)

Das Repo läuft auf Node 20 LTS (siehe `.nvmrc` und `package.json` `engines`).

```bash
# NodeSource-Repo einrichten
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -

# Node + npm installieren
sudo apt-get install -y nodejs
node --version    # erwartet: v20.x
npm --version     # erwartet: 10.x
```

### 4.2 SQLite-CLI & jq (für DB-Backups und den Auto-Update-Helper)

```bash
sudo apt-get install -y sqlite3 jq
sqlite3 --version
jq --version
```

### 4.3 Build-Tools für `better-sqlite3` (ARM-Native-Build)

`npm ci --omit=dev --workspace=backend` im Deploy-Workflow kompiliert
`better-sqlite3` nativ. Dafür brauchen wir die üblichen Build-Tools:

```bash
sudo apt-get install -y build-essential python3
```

## Schritt 5 — User und Verzeichnis-Layout

Aus [`DEPLOYMENT.md`](./DEPLOYMENT.md) (Auszug):

```bash
# App-User (führt den systemd-Service)
sudo useradd --system --no-create-home --shell /usr/sbin/nologin getraenke

# Runner-User (führt GitHub-Actions-Jobs aus, Mitglied der Gruppe getraenke)
sudo useradd --system --create-home --groups getraenke --shell /bin/bash getraenke-runner

# Verzeichnis-Eigentum
sudo install -d -m 0775 -o getraenke-runner -g getraenke /opt/getraenke
sudo install -d -m 0775 -o getraenke-runner -g getraenke /opt/getraenke/releases
sudo install -d -m 0775 -o getraenke-runner -g getraenke /var/backups/getraenke

# /var/lib/getraenke wird automatisch via StateDirectory=getraenke
# beim ersten Service-Start angelegt (siehe scripts/getraenke.service).
```

## Schritt 6 — ENV-File und sudoers

Beide Schritte sind in [`DEPLOYMENT.md`](./DEPLOYMENT.md) detailliert:

- ENV-File anlegen: `/etc/getraenke/env` (Mode 0640, root:getraenke, mit
  `JWT_SECRET` aus `openssl rand -hex 48`).
- sudoers installieren: `scripts/getraenke-deploy.sudoers` →
  `/etc/sudoers.d/getraenke-deploy`, mit `sudo visudo -cf` validiert.

## Schritt 7 — Cron-Backup

Tägliches Hot-Backup der SQLite-DB (zusätzlich zum Deploy-Backup):

```bash
sudo -u getraenke-runner crontab -e
```

```cron
# Täglich um 03:30 lokale Zeit: DB-Backup nach /var/backups/getraenke/
30 3 * * *   /opt/getraenke/current/scripts/backup-db.sh /var/lib/getraenke/getraenke.db /var/backups/getraenke
# Täglich um 03:35: Profilbilder sichern (liegen im Dateisystem, nicht in der DB)
35 3 * * *   tar czf /var/backups/getraenke/avatars-$(date -u +\%Y\%m\%dT\%H\%M\%SZ).tar.gz -C /var/lib/getraenke avatars
```

Das `scripts/backup-db.sh`-Skript aus M2 rotiert Backups älter als 7 Tage
automatisch — Env-Variable `KEEP_DAYS` anpassbar.

Die Profilbilder unter `/var/lib/getraenke/avatars` liegen **nicht** in der
SQLite-DB (die DB hält nur den Dateinamen in `members.avatar_path`), daher der
separate `tar`-Job. So sind DB **und** Avatare Teil des täglichen Backups und
werden vom Off-Site-`rsync` unten gemeinsam mitgenommen. (`%`-Zeichen sind im
Crontab mit `\%` maskiert.)

**Off-Site-Backup** (manuell oder via Cron auf einem anderen Host):

```bash
# Vom Backup-Host aus, z. B. wöchentlich:
rsync -avz pi-admin@getraenke-pi:/var/backups/getraenke/ ~/getraenke-backups/
```

## Schritt 8 — Self-Hosted Runner

Siehe dedizierte Anleitung in [`RUNNER-SETUP.md`](./RUNNER-SETUP.md).

## Schritt 9 — Smoke-Test

Nach dem ersten Tag-Push (z. B. `git tag v0.1.0 && git push origin v0.1.0`)
sollte der Deploy-Workflow auf dem Pi laufen. Manueller Check:

```bash
# Service-Status
sudo systemctl status getraenke.service

# Logs live (pino-JSON)
sudo journalctl -u getraenke.service -f

# Health-Endpoint von außen (vom Vereins-LAN aus)
curl -fsS http://getraenke-pi.local:3001/api/v1/health
```

## Schritt 10 — Auto-Update (M14)

Automatisches App-Update alle zwei Wochen + manueller Anstoß durch Admins.
Ausführliche Architektur (Privilege-Separation, Marker-/Status-Datei) in
[`AUTO-UPDATE.md`](./AUTO-UPDATE.md) — hier nur die Installation:

```bash
# 1) Token-Konfiguration anlegen (Fine-Grained-PAT, nur "Contents: Read-only")
sudo install -d -m 0755 /etc/getraenke
sudo cp scripts/update.env.example /etc/getraenke/update.env
sudo nano /etc/getraenke/update.env      # GITHUB_TOKEN eintragen
sudo chown root:root /etc/getraenke/update.env
sudo chmod 0600 /etc/getraenke/update.env

# 2) Units installieren
sudo cp scripts/getraenke-update.service scripts/getraenke-update.path \
        scripts/getraenke-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now getraenke-update.path getraenke-update.timer

# 3) Manueller Testlauf
sudo systemctl start getraenke-update.service
sudo journalctl -u getraenke-update -f
cat /var/lib/getraenke/update-status.json
```

Voraussetzung: mindestens ein Tag-Deploy muss bereits gelaufen sein
(`/opt/getraenke/current` muss existieren — der Helper liegt selbst im
Release-Tarball unter `scripts/pi-self-update.sh`).

## Troubleshooting

| Symptom                                    | Wahrscheinliche Ursache                                    | Fix                                                                     |
| ------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| SD-Karte korrupt nach Tagen Betrieb        | Unterspannung (zu schwaches Netzteil)                      | Original 3 A USB-C-Netzteil verwenden, dmesg auf `under-voltage` prüfen |
| `npm ci` schlägt mit native-build-Fehler   | `build-essential`/`python3` fehlt                          | Schritt 4.3 nachholen                                                   |
| `curl /api/v1/health` → connection refused | ufw blockt Port 3001 oder Service noch im Boot             | `sudo ufw status`, `sudo systemctl status getraenke.service`            |
| `Failed to set up StateDirectory`          | systemd zu alt (< 235)                                     | Bookworm bringt systemd 252 — `apt full-upgrade` durchführen            |
| Runner registriert sich nicht              | `getraenke-runner` hat keine Internet-/HTTPS-Konnektivität | `curl -fsS https://api.github.com` testen, ufw outgoing prüfen          |
