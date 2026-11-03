import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildApp } from '../../src/app';

describe('Dashboard Frontend API', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = buildApp({}, { logger: false });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET / returns 200 with HTML content and TikTok connection console', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('TikUser LIVE — TikTok Broadcast Console');
    expect(response.body).toContain('TikTok Creator Username');
    expect(response.body).toContain('usernameInput');
    expect(response.body).toContain('connectBtn');
  });

  it('GET /dashboard returns the same HTML console', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/dashboard',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('id="usernameInput"');
    expect(response.body).toContain('id="modeMockBtn"');
    expect(response.body).toContain('id="modeLiveBtn"');
  });

  it('GET /live alias returns the same HTML console', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/live',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('eventsContainer');
  });
});
