#!/usr/bin/env bash
# scripts/pi-release.sh
#
# Installiert ein gebautes Release auf dem Pi: Backup, Entpacken,
# Produktions-Dependencies, Migrationen, atomarer Symlink-Swap, Neustart,
# Smoke-Test — mit automatischem Rollback, falls der Neustart oder der
# Smoke-Test nach dem Swap fehlschlägt.
#
# Wird sowohl vom Tag-Deploy (.github/workflows/deploy.yml, Job "deploy")
# als auch vom Auto-Update-Helper (scripts/pi-self-update.sh, M14)
# aufgerufen — ein Release-Pfad, ein Rollback-Verhalten, kein Drift.
#
# Aufruf:
#   ./scripts/pi-release.sh <tarball-pfad> <tag>
#
# Beispiel:
#   ./scripts/pi-release.sh /tmp/deploy/release-v0.2.0.tar.gz v0.2.0
#
# Konfiguration (ENV, alle optional mit sinnvollen Defaults):
#   RELEASES_DIR   Verzeichnis für entpackte Releases   (/opt/getraenke/releases)
#   CURRENT_LINK   Symlink auf das aktive Release        (/opt/getraenke/current)
#   DB_PATH        Pfad zur SQLite-DB                    (/var/lib/getraenke/getraenke.db)
#   BACKUP_DIR     Zielverzeichnis für DB-Backups         (/var/backups/getraenke)
#   HEALTH_URL     Health-Endpoint für den Smoke-Test     (http://localhost:3001/api/v1/health)
#   KEEP_RELEASES  Anzahl aufzuhebender alter Releases    (5)
#
# Voraussetzungen: siehe docs/DEPLOYMENT.md — sudo-Rechte für
# `systemctl restart getraenke.service` (scripts/getraenke-deploy.sudoers),
# scripts/deploy-migrate.sh liegt im entpackten Release.
#
# Schlägt das Skript vor dem Symlink-Swap fehl (Backup/Entpacken/npm
# ci/Migrationen), bleibt der aktive Symlink unangetastet — kein Rollback
# nötig. Schlägt es NACH dem Swap fehl (Neustart/Smoke-Test), wird
# automatisch auf das vorherige Release zurückgeswappt.

set -euo pipefail

TARBALL="${1:?Tarball-Pfad fehlt (z. B. /tmp/deploy/release-v0.2.0.tar.gz)}"
TAG="${2:?Tag fehlt (z. B. v0.2.0)}"

RELEASES_DIR="${RELEASES_DIR:-/opt/getraenke/releases}"
CURRENT_LINK="${CURRENT_LINK:-/opt/getraenke/current}"
DB_PATH="${DB_PATH:-/var/lib/getraenke/getraenke.db}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/getraenke}"
HEALTH_URL="${HEALTH_URL:-http://localhost:3001/api/v1/health}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

RELEASE_DIR="$RELEASES_DIR/$TAG"
PREVIOUS=""
SWAPPED=false

log() {
  echo "[pi-release] $*"
}

rollback() {
  log "FEHLER nach Symlink-Swap — starte Rollback."
  if [[ -z "$PREVIOUS" ]]; then
    log "Kein vorheriges Release vorhanden — manueller Eingriff nötig." >&2
    return
  fi
  log "ROLLBACK auf $PREVIOUS"
  ln -sfn "$PREVIOUS" "$CURRENT_LINK.rollback"
  mv -Tf "$CURRENT_LINK.rollback" "$CURRENT_LINK"
  sudo /usr/bin/systemctl restart getraenke.service || true
  log "Rollback abgeschlossen — pi-release.sh wird trotzdem mit Fehler beendet."
}

on_error() {
  if [[ "$SWAPPED" == "true" ]]; then
    rollback
  fi
  exit 1
}

trap on_error ERR

# ---------------------------------------------------------------------------
# 1) Aktuellen Symlink-Stand merken (Rollback-Anker).
# ---------------------------------------------------------------------------
if [[ -L "$CURRENT_LINK" ]]; then
  PREVIOUS=$(readlink -f "$CURRENT_LINK")
fi
log "Vorheriges Release: ${PREVIOUS:-<keines (Initial-Deploy)>}"

# ---------------------------------------------------------------------------
# 2) DB-Backup (Hot-Backup via SQLite-eigene API, WAL-sicher).
# ---------------------------------------------------------------------------
mkdir -p "$BACKUP_DIR"
if [[ -f "$DB_PATH" ]]; then
  STAMP=$(date -u +"%Y%m%dT%H%M%SZ")
  BACKUP_DEST="$BACKUP_DIR/$TAG-$STAMP.sqlite"
  sqlite3 "$DB_PATH" ".backup '$BACKUP_DEST'"
  log "Backup: $BACKUP_DEST ($(du -h "$BACKUP_DEST" | cut -f1))"
else
  log "Keine bestehende DB unter $DB_PATH — überspringe Backup."
fi

# ---------------------------------------------------------------------------
# 3) Release entpacken.
# ---------------------------------------------------------------------------
if [[ -d "$RELEASE_DIR" ]]; then
  log "Release-Verzeichnis existiert (Re-Deploy) — entferne es."
  rm -rf "$RELEASE_DIR"
fi
mkdir -p "$RELEASE_DIR"
tar -xzf "$TARBALL" -C "$RELEASE_DIR"
chmod +x "$RELEASE_DIR/scripts/deploy-migrate.sh"

# ---------------------------------------------------------------------------
# 4) Produktions-Dependencies installieren (better-sqlite3 ARM-Build).
# ---------------------------------------------------------------------------
(
  cd "$RELEASE_DIR"
  npm ci --omit=dev --workspace=backend --include-workspace-root=false
)

# ---------------------------------------------------------------------------
# 5) Migrationen ausführen (als App-User getraenke).
# ---------------------------------------------------------------------------
"$RELEASE_DIR/scripts/deploy-migrate.sh" "$RELEASE_DIR"

# ---------------------------------------------------------------------------
# 6) Symlink atomar swappen. Ab hier greift bei Fehlern der Rollback-Trap.
# ---------------------------------------------------------------------------
NEW_LINK="$CURRENT_LINK.new"
ln -sfn "$RELEASE_DIR" "$NEW_LINK"
mv -Tf "$NEW_LINK" "$CURRENT_LINK"
SWAPPED=true
log "Symlink: $CURRENT_LINK → $(readlink -f "$CURRENT_LINK")"

# ---------------------------------------------------------------------------
# 7) Service neu starten.
# ---------------------------------------------------------------------------
sudo /usr/bin/systemctl restart getraenke.service
RESTART_OK=false
for i in 1 2 3 4 5; do
  if sudo /usr/bin/systemctl is-active --quiet getraenke.service; then
    log "Service aktiv (Versuch $i)."
    RESTART_OK=true
    break
  fi
  sleep 2
done
if [[ "$RESTART_OK" != "true" ]]; then
  log "Service nicht aktiv nach 10 s." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# 8) Smoke-Test (/api/v1/health).
# ---------------------------------------------------------------------------
SMOKE_OK=false
for i in 1 2 3 4 5; do
  if curl -fsS --max-time 10 "$HEALTH_URL" > /tmp/pi-release-health.json; then
    log "Health-Check OK (Versuch $i):"
    cat /tmp/pi-release-health.json
    SMOKE_OK=true
    break
  fi
  log "Versuch $i fehlgeschlagen, retry in 2 s …"
  sleep 2
done
if [[ "$SMOKE_OK" != "true" ]]; then
  log "Smoke-Test fehlgeschlagen nach 5 Versuchen." >&2
  exit 1
fi

# Ab hier ist das Release verifiziert — kein Rollback mehr nötig.
trap - ERR

# ---------------------------------------------------------------------------
# 9) Alte Releases aufräumen (letzte KEEP_RELEASES behalten).
# ---------------------------------------------------------------------------
ACTIVE=$(basename "$(readlink -f "$CURRENT_LINK")")
# Release-Verzeichnisnamen sind immer vX.Y.Z (rein alphanumerisch), daher ist
# `ls` zum Sortieren nach mtime hier unproblematisch.
# shellcheck disable=SC2012
mapfile -t OLD < <(cd "$RELEASES_DIR" && ls -1dt v*/ 2>/dev/null | tail -n +$((KEEP_RELEASES + 1)))
if [[ ${#OLD[@]} -eq 0 ]]; then
  log "Nichts zu löschen — ≤ $KEEP_RELEASES Releases vorhanden."
else
  for d in "${OLD[@]}"; do
    name="${d%/}"
    if [[ "$name" == "$ACTIVE" ]]; then
      log "Übersprungen (= aktiv): $name"
      continue
    fi
    log "Lösche altes Release: $name"
    rm -rf "${RELEASES_DIR:?}/$name"
  done
fi

log "✓ Release $TAG erfolgreich installiert."
