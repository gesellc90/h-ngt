import fs from 'node:fs';
import path from 'node:path';
import type { AuditLogRepo } from '../db/repos/AuditLogRepo.js';
import { AppError } from '../middleware/errorHandler.js';

// ---------------------------------------------------------------------------
// UpdateService — Admin-seitiger Blick auf den Auto-Update-Mechanismus (M14).
//
// Dieser Service macht NIEMALS selbst einen Netzabruf zu GitHub und braucht
// kein sudo. Er tut genau zwei Dinge:
//   1. `getStatus()` liest die Status-Datei, die der privilegierte
//      Pi-Helper (scripts/pi-self-update.sh) nach jedem Lauf schreibt.
//   2. `requestUpdate()`/`requestCheck()` schreiben eine harmlose
//      Marker-Datei ("update" bzw. "check") in dasselbe Verzeichnis — eine
//      systemd-Path-Unit auf dem Pi beobachtet sie und startet den Helper.
// Die Marker-Datei enthält bewusst keine Versionsangabe und kein Kommando,
// nur eine von zwei fest verdrahteten Modus-Kennungen — siehe
// docs/AUTO-UPDATE.md.
// ---------------------------------------------------------------------------

export type UpdateResult =
  | 'unknown'
  | 'up_to_date'
  | 'update_available'
  | 'in_progress'
  | 'success'
  | 'failed';

export interface UpdateStatus {
  current_version: string | null;
  available_version: string | null;
  last_checked_at: string | null;
  last_result: UpdateResult;
  last_trigger: string | null;
  in_progress: boolean;
}

const UNKNOWN_STATUS: UpdateStatus = {
  current_version: null,
  available_version: null,
  last_checked_at: null,
  last_result: 'unknown',
  last_trigger: null,
  in_progress: false,
};

function isUpdateResult(value: unknown): value is UpdateResult {
  return (
    typeof value === 'string' &&
    ['unknown', 'up_to_date', 'update_available', 'in_progress', 'success', 'failed'].includes(
      value,
    )
  );
}

/** Best-effort-Parsing: eine fehlende oder kaputte Datei ist kein Fehler, sondern „unknown". */
function parseStatus(raw: string): UpdateStatus {
  const data: unknown = JSON.parse(raw);
  if (typeof data !== 'object' || data === null) return UNKNOWN_STATUS;
  const d = data as Record<string, unknown>;
  return {
    current_version: typeof d['current_version'] === 'string' ? d['current_version'] : null,
    available_version: typeof d['available_version'] === 'string' ? d['available_version'] : null,
    last_checked_at: typeof d['last_checked_at'] === 'string' ? d['last_checked_at'] : null,
    last_result: isUpdateResult(d['last_result']) ? d['last_result'] : 'unknown',
    last_trigger: typeof d['last_trigger'] === 'string' ? d['last_trigger'] : null,
    in_progress: d['in_progress'] === true,
  };
}

export class UpdateService {
  private readonly statusFile: string;
  private readonly markerFile: string;

  constructor(
    stateDir: string,
    private readonly auditLog: AuditLogRepo,
  ) {
    this.statusFile = path.join(stateDir, 'update-status.json');
    this.markerFile = path.join(stateDir, 'update-requested');
  }

  /**
   * Liest den zuletzt vom Pi-Helper geschriebenen Status. Wirft nie —
   * eine fehlende Datei (z. B. vor dem ersten Update-Lauf) oder ein
   * unerwartetes Format ergeben schlicht `last_result: "unknown"`.
   */
  getStatus(): UpdateStatus {
    let raw: string;
    try {
      raw = fs.readFileSync(this.statusFile, 'utf-8');
    } catch {
      return UNKNOWN_STATUS;
    }

    try {
      return parseStatus(raw);
    } catch {
      return UNKNOWN_STATUS;
    }
  }

  requestUpdate(actorId: number): void {
    this.requestMode('update', actorId);
  }

  requestCheck(actorId: number): void {
    this.requestMode('check', actorId);
  }

  private requestMode(mode: 'update' | 'check', actorId: number): void {
    const status = this.getStatus();
    if (status.in_progress) {
      throw new AppError('Ein Update läuft bereits', 409, 'UPDATE_IN_PROGRESS');
    }
    if (fs.existsSync(this.markerFile)) {
      throw new AppError('Eine Update-Anfrage ist bereits offen', 409, 'UPDATE_IN_PROGRESS');
    }

    fs.mkdirSync(path.dirname(this.markerFile), { recursive: true });
    // Atomar schreiben (tmp + rename), damit die watchende Path-Unit auf dem
    // Pi nie eine halbgeschriebene Datei sieht.
    const tmpFile = `${this.markerFile}.tmp-${process.pid}`;
    fs.writeFileSync(tmpFile, mode, 'utf-8');
    fs.renameSync(tmpFile, this.markerFile);

    this.auditLog.create({
      event_type: 'update_requested',
      actor_id: actorId,
      target_type: 'update',
      target_id: null,
      meta: { mode },
    });
  }
}
