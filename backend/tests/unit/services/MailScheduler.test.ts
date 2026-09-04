/**
 * Unit-Tests für `computeDueBillingPeriod` (MailScheduler) — die reine
 * Kernfrage "ist der Versand-Termin für den Vormonat erreicht?".
 *
 * Bewusst als reine Funktion getestet (kein Fake-Timer nötig): sie bekommt
 * `now` explizit übergeben und liefert deterministisch `{year, month}` des
 * abzurechnenden Vormonats oder `null`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import pino from 'pino';
import { computeDueBillingPeriod, MailScheduler } from '../../../src/services/MailScheduler.js';
import type { BillingMailService } from '../../../src/services/BillingMailService.js';

describe('computeDueBillingPeriod', () => {
  it('liefert null am 1. des Monats, aber vor der konfigurierten Stunde', () => {
    // 1. März, 01:00 Uhr Berliner Zeit (00:00 UTC im Winter) — vor 03:00.
    const now = new Date('2026-03-01T01:00:00.000Z');
    expect(computeDueBillingPeriod(now, 3)).toBeNull();
  });

  it('liefert den Vormonat, sobald die konfigurierte Stunde am 1. erreicht ist', () => {
    // 1. März, 03:00 Uhr Berliner Zeit (Winterzeit, UTC+1) = 02:00 UTC.
    const now = new Date('2026-03-01T02:00:00.000Z');
    expect(computeDueBillingPeriod(now, 3)).toEqual({ year: 2026, month: 2 });
  });

  it('bleibt fällig, wenn der Termin bereits länger verstrichen ist (Catch-up)', () => {
    // 15. März — Pi war den ganzen 1. über aus.
    const now = new Date('2026-03-15T12:00:00.000Z');
    expect(computeDueBillingPeriod(now, 3)).toEqual({ year: 2026, month: 2 });
  });

  it('rechnet den Jahreswechsel korrekt (Januar → Dezember des Vorjahres)', () => {
    const now = new Date('2027-01-01T05:00:00.000Z');
    expect(computeDueBillingPeriod(now, 3)).toEqual({ year: 2026, month: 12 });
  });

  it('berücksichtigt die Sommerzeit (Europe/Berlin, UTC+2 im Sommer)', () => {
    // 1. Juli, 03:00 Uhr Berliner Sommerzeit = 01:00 UTC.
    const dueAt3 = new Date('2026-07-01T01:00:00.000Z');
    expect(computeDueBillingPeriod(dueAt3, 3)).toEqual({ year: 2026, month: 6 });

    const before = new Date('2026-07-01T00:30:00.000Z');
    expect(computeDueBillingPeriod(before, 3)).toBeNull();
  });
});

describe('MailScheduler', () => {
  const silentLogger = pino({ level: 'silent' });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prüft beim Start sofort (Catch-up) und ruft billingMailService.run bei Fälligkeit auf', async () => {
    // Fest auf einen Zeitpunkt nach dem Termin (1. des Monats, 03:00 Berlin) setzen.
    vi.setSystemTime(new Date('2026-03-15T12:00:00.000Z'));
    const run = vi.fn().mockResolvedValue({ period: '2026-02', lines: [] });
    const billingMailService = { run } as unknown as BillingMailService;

    const scheduler = new MailScheduler(billingMailService, { hour: 3 }, silentLogger);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith(2026, 2, {
      triggeredBy: 'schedule',
      dryRun: false,
      actorId: null,
    });
    scheduler.stop();
  });

  it('ruft billingMailService.run NICHT auf, solange der Termin nicht erreicht ist', async () => {
    vi.setSystemTime(new Date('2026-03-01T01:00:00.000Z')); // vor 03:00 Berlin
    const run = vi.fn().mockResolvedValue({ period: '2026-02', lines: [] });
    const billingMailService = { run } as unknown as BillingMailService;

    const scheduler = new MailScheduler(billingMailService, { hour: 3 }, silentLogger);
    scheduler.start();
    await vi.advanceTimersByTimeAsync(0);

    expect(run).not.toHaveBeenCalled();
    scheduler.stop();
  });

  it('stop() beendet den Intervall-Timer', () => {
    const run = vi.fn().mockResolvedValue({ period: '2026-02', lines: [] });
    const billingMailService = { run } as unknown as BillingMailService;
    const scheduler = new MailScheduler(billingMailService, { hour: 3 }, silentLogger);

    scheduler.start();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    scheduler.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('start() ist idempotent — ein zweiter Aufruf legt keinen weiteren Timer an', () => {
    const run = vi.fn().mockResolvedValue({ period: '2026-02', lines: [] });
    const billingMailService = { run } as unknown as BillingMailService;
    const scheduler = new MailScheduler(billingMailService, { hour: 3 }, silentLogger);

    scheduler.start();
    const countAfterFirst = vi.getTimerCount();
    scheduler.start();
    expect(vi.getTimerCount()).toBe(countAfterFirst);
    scheduler.stop();
  });
});
