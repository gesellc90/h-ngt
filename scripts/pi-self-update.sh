#!/usr/bin/env bash
# scripts/pi-self-update.sh
#
# Auto-Update-Helper (M14): prüft das neueste stabile GitHub-Release und
# installiert es bei Bedarf über scripts/pi-release.sh. Wird ausschließlich
# durch systemd angestoßen — NICHT vom App-Prozess selbst:
#
#   getraenke-update.timer  — alle zwei Wochen (voller Update-Lauf)
#   getraenke-update.path   — beobachtet /var/lib/getraenke/update-requested
#                              (vom Admin-Bereich über die App geschrieben)
#
# Beide lösen dieselbe Unit aus: getraenke-update.service (läuft als root —
# siehe docs/AUTO-UPDATE.md „Privilege-Separation"). Der App-Dienst
# (getraenke.service) selbst bleibt strikt unprivilegiert und macht keinen
# eigenen Netzabruf zu GitHub.
#
# Modus-Bestimmung:
#   - Existiert die Marker-Datei, wird ihr Inhalt gelesen ("update" oder
#     "check") und die Datei danach gelöscht (konsumiert). Kein Marker
#     vorhanden → Timer-Trigger → voller Update-Lauf.
#   - Der Marker enthält NIE eine Versionsangabe oder ein Kommando — er
#     wählt nur zwischen zwei fest verdrahteten, ungefährlichen Codepfaden.
#     Das Ziel („neuestes stabiles Release") bestimmt ausschließlich dieses
#     Skript, nie der App-Prozess.
#
# Ergebnis wird immer nach /var/lib/getraenke/update-status.json geschrieben
# (current_version, available_version, last_checked_at, last_result,
# last_trigger, in_progress) — das ist der einzige Weg, wie die App den
# Update-Status erfährt.
#
# Voraussetzungen: jq, curl, sqlite3 (für pi-release.sh), Ausführung als
# root (systemd-Unit), /etc/getraenke/update.env lesbar (GITHUB_REPO,
# GITHUB_TOKEN — Fine-Grained-PAT mit ausschließlich „Contents: Read-only"
# auf dieses Repo, siehe scripts/update.env.example).

set -euo pipefail

STATE_DIR="${STATE_DIR:-/var/lib/getraenke}"
CURRENT_LINK="${CURRENT_LINK:-/opt/getraenke/current}"
UPDATE_ENV_FILE="${UPDATE_ENV_FILE:-/etc/getraenke/update.env}"

MARKER_FILE="$STATE_DIR/update-requested"
STATUS_FILE="$STATE_DIR/update-status.json"
LOCK_FILE="$STATE_DIR/.update.lock"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PI_RELEASE_SH="$SCRIPT_DIR/pi-release.sh"

log() {
  echo "[pi-self-update] $*"
}

# ---------------------------------------------------------------------------
# Konfiguration laden.
# ---------------------------------------------------------------------------
if [[ ! -r "$UPDATE_ENV_FILE" ]]; then
  echo "[pi-self-update] Fehler: $UPDATE_ENV_FILE nicht lesbar." >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
source "$UPDATE_ENV_FILE"
set +a
: "${GITHUB_REPO:?GITHUB_REPO fehlt in $UPDATE_ENV_FILE (Format owner/repo)}"
: "${GITHUB_TOKEN:?GITHUB_TOKEN fehlt in $UPDATE_ENV_FILE}"

if [[ ! -x "$PI_RELEASE_SH" ]]; then
  echo "[pi-self-update] Fehler: $PI_RELEASE_SH fehlt oder ist nicht ausführbar." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Nicht zwei Läufe parallel (Timer + Admin-Trigger könnten kollidieren).
# ---------------------------------------------------------------------------
mkdir -p "$STATE_DIR"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  log "Ein Update-Lauf ist bereits aktiv — überspringe."
  exit 0
fi

# ---------------------------------------------------------------------------
# Aktive Version ermitteln.
# ---------------------------------------------------------------------------
ACTIVE_TAG=""
if [[ -L "$CURRENT_LINK" ]]; then
  ACTIVE_TAG="$(basename "$(readlink -f "$CURRENT_LINK")")"
fi
AVAILABLE_TAG=""

# ---------------------------------------------------------------------------
# Modus bestimmen: Marker konsumieren (falls vorhanden) oder Timer-Default.
# ---------------------------------------------------------------------------
MODE="update"
TRIGGER="timer"
if [[ -f "$MARKER_FILE" ]]; then
  RAW_MODE="$(tr -d '[:space:]' < "$MARKER_FILE" 2>/dev/null || true)"
  rm -f "$MARKER_FILE"
  TRIGGER="admin"
  if [[ "$RAW_MODE" == "check" ]]; then
    MODE="check"
  else
    MODE="update"
  fi
fi
log "Modus: $MODE (Auslöser: $TRIGGER, aktive Version: ${ACTIVE_TAG:-<keine>})"

write_status() {
  local result="$1"
  local in_progress="false"
  [[ "$result" == "in_progress" ]] && in_progress="true"
  local now
  now="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  jq -n \
    --arg current "$ACTIVE_TAG" \
    --arg available "$AVAILABLE_TAG" \
    --arg checked_at "$now" \
    --arg result "$result" \
    --arg trigger "$TRIGGER" \
    --argjson in_progress "$in_progress" \
    '{
      current_version: (if $current == "" then null else $current end),
      available_version: (if $available == "" then null else $available end),
      last_checked_at: $checked_at,
      last_result: $result,
      last_trigger: $trigger,
      in_progress: $in_progress
    }' > "$STATUS_FILE.tmp"
  mv -f "$STATUS_FILE.tmp" "$STATUS_FILE"
  chmod 0644 "$STATUS_FILE"
}

# ---------------------------------------------------------------------------
# Neuestes stabiles Release über die GitHub-API abfragen.
# ---------------------------------------------------------------------------
API_URL="https://api.github.com/repos/$GITHUB_REPO/releases/latest"
RESPONSE=""
if ! RESPONSE=$(curl -fsS --max-time 15 \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/vnd.github+json" \
    -H "X-GitHub-Api-Version: 2022-11-28" \
    "$API_URL"); then
  log "GitHub-API nicht erreichbar." >&2
  write_status "failed"
  exit 1
fi

AVAILABLE_TAG="$(echo "$RESPONSE" | jq -r '.tag_name // empty')"
ASSET_URL="$(echo "$RESPONSE" | jq -r --arg name "release-${AVAILABLE_TAG}.tar.gz" \
  '.assets[]? | select(.name == $name) | .url // empty')"

if [[ -z "$AVAILABLE_TAG" || -z "$ASSET_URL" ]]; then
  log "Konnte kein aktuelles Release/Asset ermitteln (Tag oder Tarball-Asset fehlt)." >&2
  write_status "failed"
  exit 1
fi

# ---------------------------------------------------------------------------
# Vergleichen und je nach Modus abschließen oder installieren.
# ---------------------------------------------------------------------------
if [[ "$ACTIVE_TAG" == "$AVAILABLE_TAG" ]]; then
  log "Bereits aktuell ($ACTIVE_TAG)."
  write_status "up_to_date"
  exit 0
fi

if [[ "$MODE" == "check" ]]; then
  log "Update verfügbar: ${ACTIVE_TAG:-<keine>} → $AVAILABLE_TAG (nur Prüfung, keine Installation)."
  write_status "update_available"
  exit 0
fi

log "Update verfügbar: ${ACTIVE_TAG:-<keine>} → $AVAILABLE_TAG — starte Installation."
write_status "in_progress"

TMP_TARBALL="$(mktemp /tmp/getraenke-update-XXXXXX.tar.gz)"
trap 'rm -f "$TMP_TARBALL"' EXIT

if ! curl -fsSL --max-time 60 \
    -H "Authorization: Bearer $GITHUB_TOKEN" \
    -H "Accept: application/octet-stream" \
    -o "$TMP_TARBALL" \
    "$ASSET_URL"; then
  log "Download des Release-Assets fehlgeschlagen." >&2
  write_status "failed"
  exit 1
fi

if "$PI_RELEASE_SH" "$TMP_TARBALL" "$AVAILABLE_TAG"; then
  log "✓ Update auf $AVAILABLE_TAG erfolgreich."
  ACTIVE_TAG="$AVAILABLE_TAG"
  write_status "success"
else
  log "Update fehlgeschlagen (pi-release.sh hat bereits ggf. zurückgerollt)." >&2
  write_status "failed"
  exit 1
fi
