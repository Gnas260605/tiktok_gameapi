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
    expect(response.body).toContain('<title>Studio | TikUser LIVE</title>');
    expect(response.body).toContain('/shared/ui.css');
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

  it('GET /game returns the Leo Chùa overlay game', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/game',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/html');
    expect(response.body).toContain('id="stage"');
    expect(response.body).toContain('Leo Chùa');
  });

  it('GET /game-assets/:file serves game art as PNG', async () => {
    const response = await app.inject({ method: 'GET', url: '/game-assets/pagoda.png' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('image/png');
    expect(response.rawPayload.subarray(1, 4).toString()).toBe('PNG');
  });

  it('GET /game-assets rejects traversal and unknown files with 404', async () => {
    for (const url of ['/game-assets/..%2Fgame.html', '/game-assets/..%2F..%2Fpackage.json', '/game-assets/missing.png']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(404);
    }
  });

  it('GET /shared/:file serves the shared UI system with the right content types', async () => {
    const cases: Array<[string, string]> = [
      ['/shared/ui.css', 'text/css'],
      ['/shared/app-shell.js', 'text/javascript'],
      ['/shared/icons.svg', 'image/svg+xml'],
    ];
    for (const [url, type] of cases) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      expect(response.headers['content-type']).toContain(type);
    }
  });

  it('GET /shared rejects traversal, other extensions and unknown files with 404', async () => {
    for (const url of ['/shared/..%2F..%2Fpackage.json', '/shared/ui.CSS', '/shared/evil.html', '/shared/missing.css']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(404);
    }
  });

  it('every page links the shared UI system', async () => {
    for (const url of ['/', '/game', '/tutien', '/tutien/admin']) {
      const response = await app.inject({ method: 'GET', url });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('href="/shared/ui.css"');
      expect(response.body).toContain('src="/shared/app-shell.js"');
      expect(response.body).toContain('data-ui-products');
    }
  });
});
