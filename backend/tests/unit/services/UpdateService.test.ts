/**
 * Unit-Tests für UpdateService (M14).
 *
 * Getestete Szenarien:
 *  - getStatus(): "unknown" wenn die Statusdatei fehlt oder kaputt ist
 *  - getStatus(): korrektes Parsen einer gültigen Statusdatei
 *  - requestUpdate()/requestCheck(): schreiben die Marker-Datei atomar mit
 *    dem richtigen Inhalt und legen einen Audit-Log-Eintrag an
 *  - requestUpdate(): 409 (AppError) wenn bereits `in_progress` oder ein
 *    Marker bereits offen ist
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestDb } from '../db/helpers.js';
import { AuditLogRepo } from '../../../src/db/repos/AuditLogRepo.js';
import { MembersRepo } from '../../../src/db/repos/MembersRepo.js';
import { UpdateService } from '../../../src/services/UpdateService.js';
import { AppError } from '../../../src/middleware/errorHandler.js';
import type { Db } from '../../../src/db/client.js';

let stateDir: string;
let db: Db;
let auditLog: AuditLogRepo;
let service: UpdateService;
let adminId: number;

beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-service-test-'));
  db = createTestDb();
  auditLog = new AuditLogRepo(db);
  service = new UpdateService(stateDir, auditLog);

  // audit_log.actor_id hat eine FK auf members(id) — Test-Admin anlegen,
  // damit requestUpdate()/requestCheck() einen gültigen Actor referenzieren.
  const membersRepo = new MembersRepo(db);
  adminId = membersRepo.create({
    username: 'admin',
    display_name: 'Admin',
    password_hash: 'x',
    role: 'admin',
  }).id;
});

afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

function statusFilePath(): string {
  return path.join(stateDir, 'update-status.json');
}

function markerFilePath(): string {
  return path.join(stateDir, 'update-requested');
}

describe('UpdateService.getStatus', () => {
  it('gibt "unknown" zurück, wenn die Statusdatei fehlt', () => {
    const status = service.getStatus();
    expect(status.last_result).toBe('unknown');
    expect(status.current_version).toBeNull();
    expect(status.in_progress).toBe(false);
  });

  it('gibt "unknown" zurück, wenn die Statusdatei kaputtes JSON enthält', () => {
    fs.writeFileSync(statusFilePath(), '{not valid json', 'utf-8');
    const status = service.getStatus();
    expect(status.last_result).toBe('unknown');
  });

  it('parst eine gültige Statusdatei korrekt', () => {
    fs.writeFileSync(
      statusFilePath(),
      JSON.stringify({
        current_version: 'v1.0.0',
        available_version: 'v1.1.0',
        last_checked_at: '2026-07-01T03:30:00Z',
        last_result: 'update_available',
        last_trigger: 'timer',
        in_progress: false,
      }),
      'utf-8',
    );

    const status = service.getStatus();
    expect(status).toEqual({
      current_version: 'v1.0.0',
      available_version: 'v1.1.0',
      last_checked_at: '2026-07-01T03:30:00Z',
      last_result: 'update_available',
      last_trigger: 'timer',
      in_progress: false,
    });
  });

  it('fällt bei unbekanntem last_result auf "unknown" zurück', () => {
    fs.writeFileSync(
      statusFilePath(),
      JSON.stringify({ last_result: 'something-unexpected', in_progress: true }),
      'utf-8',
    );
    const status = service.getStatus();
    expect(status.last_result).toBe('unknown');
    expect(status.in_progress).toBe(true);
  });
});

describe('UpdateService.requestUpdate / requestCheck', () => {
  it('schreibt die Marker-Datei mit Inhalt "update" und legt einen Audit-Log-Eintrag an', () => {
    service.requestUpdate(adminId);

    expect(fs.readFileSync(markerFilePath(), 'utf-8')).toBe('update');

    const entries = auditLog.findByEventType('update_requested');
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actor_id).toBe(adminId);
    expect(JSON.parse(entries[0]?.meta ?? '{}')).toEqual({ mode: 'update' });
  });

  it('schreibt die Marker-Datei mit Inhalt "check"', () => {
    service.requestCheck(adminId);
    expect(fs.readFileSync(markerFilePath(), 'utf-8')).toBe('check');
  });

  it('wirft 409, wenn der Status bereits in_progress ist', () => {
    fs.writeFileSync(
      statusFilePath(),
      JSON.stringify({ last_result: 'in_progress', in_progress: true }),
      'utf-8',
    );

    expect(() => service.requestUpdate(adminId)).toThrow(AppError);
    try {
      service.requestUpdate(adminId);
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).statusCode).toBe(409);
      expect((err as AppError).code).toBe('UPDATE_IN_PROGRESS');
    }
  });

  it('wirft 409, wenn bereits eine Marker-Datei offen ist', () => {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(markerFilePath(), 'check', 'utf-8');

    expect(() => service.requestUpdate(adminId)).toThrow(AppError);
  });

  it('legt das state-Verzeichnis an, falls es noch nicht existiert', () => {
    const freshDir = path.join(stateDir, 'nested', 'state');
    const freshService = new UpdateService(freshDir, auditLog);

    expect(() => freshService.requestUpdate(adminId)).not.toThrow();
    expect(fs.readFileSync(path.join(freshDir, 'update-requested'), 'utf-8')).toBe('update');
  });
});
