/**
 * Unit-Tests für loadEnv – Validierung & Defaults der ENV-Konfiguration.
 */

import { describe, it, expect } from 'vitest';
import { loadEnv } from '../../../src/utils/env.js';

const MIN_SECRET = 'x'.repeat(32);

describe('loadEnv', () => {
  it('akzeptiert eine minimale gültige Konfiguration und setzt Defaults', () => {
    const env = loadEnv({ JWT_SECRET: MIN_SECRET });
    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3001);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.DB_PATH).toBe('./data/getraenke.db');
    expect(env.JWT_EXPIRES_IN).toBe('8h');
    expect(env.AVATAR_DIR).toBe('./data/avatars');
    expect(env.UPDATE_STATE_DIR).toBe('./data');
    expect(env.TRUST_PROXY).toBe(0);
  });

  it('wirft, wenn JWT_SECRET fehlt', () => {
    expect(() => loadEnv({})).toThrow(/JWT_SECRET/);
  });

  it('wirft, wenn JWT_SECRET zu kurz ist', () => {
    expect(() => loadEnv({ JWT_SECRET: 'zu-kurz' })).toThrow(/mindestens 32/);
  });

  it('coerct PORT und TRUST_PROXY aus Strings', () => {
    const env = loadEnv({ JWT_SECRET: MIN_SECRET, PORT: '8080', TRUST_PROXY: '1' });
    expect(env.PORT).toBe(8080);
    expect(env.TRUST_PROXY).toBe(1);
  });

  it('lehnt ein negatives TRUST_PROXY ab', () => {
    expect(() => loadEnv({ JWT_SECRET: MIN_SECRET, TRUST_PROXY: '-1' })).toThrow();
  });

  it('lehnt ein ungültiges NODE_ENV ab', () => {
    expect(() => loadEnv({ JWT_SECRET: MIN_SECRET, NODE_ENV: 'staging' })).toThrow();
  });
});
