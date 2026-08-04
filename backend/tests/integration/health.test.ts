import { describe, it, expect } from 'vitest';
import request from 'supertest';
import pino from 'pino';
import { createApp } from '../../src/app.js';
import { createTestDb } from '../unit/db/helpers.js';

const silentLogger = pino({ level: 'silent' });
const testEnv = {
  NODE_ENV: 'test' as const,
  PORT: 3001,
  LOG_LEVEL: 'silent' as const,
  DB_PATH: ':memory:',
  JWT_SECRET: 'test-secret-that-is-at-least-32-characters-long',
  JWT_EXPIRES_IN: '8h',
  AVATAR_DIR: '/tmp',
  UPDATE_STATE_DIR: '/tmp',
  TRUST_PROXY: 0,
};

describe('GET /api/v1/health', () => {
  const db = createTestDb();
  const app = createApp({ logger: silentLogger, db, env: testEnv });

  it('antwortet mit 200 und Status "ok"', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'ok' });
    expect(typeof res.body.uptime).toBe('number');
    expect(() => new Date(res.body.timestamp).toISOString()).not.toThrow();
  });
});
