/**
 * THE RELAY'S STATIC FILES NEVER LEAVE THEIR ROOT (the independent read of 2026-11-20).
 *
 * The handler checked the resolved path with `startsWith(root)` and no separator, so a sibling directory whose name
 * starts with the root's name passed (`/srv/site` and `/srv/site-secret`); it also served dotfiles (`.env`) and
 * followed a link out of the root. Each request below is sent with its path exactly as written (no client
 * normalisation).
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { startRelay } from '../src/server.js';

let relay; let base;
beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'relay-static-'));
  mkdirSync(join(base, 'site'));
  mkdirSync(join(base, 'site-secret'));
  writeFileSync(join(base, 'site', 'index.html'), '<p>hallo</p>');
  writeFileSync(join(base, 'site', '.env'), 'SECRET=dotfile');
  writeFileSync(join(base, 'site-secret', 'secret.txt'), 'SECRET=sibling');
  writeFileSync(join(base, 'outside.txt'), 'SECRET=linked');
  symlinkSync(join(base, 'outside.txt'), join(base, 'site', 'link.txt'));
  relay = await startRelay({ port: 0, serveStaticDir: join(base, 'site') });
});
afterAll(async () => { await relay?.stop?.(); });

const get = (path) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: relay.port, path, method: 'GET' }, (res) => {
    let body = ''; res.on('data', (c) => { body += c; }); res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('error', reject); req.end();
});

describe('the relay serves only what is inside its static root', () => {
  it('serves a file inside the root', async () => {
    const r = await get('/index.html');
    expect(r.status).toBe(200);
    expect(r.body).toContain('hallo');
  });

  it.each([
    ['a sibling directory whose name starts with the root\'s', '/../site-secret/secret.txt'],
    ['the same, percent-encoded', '/%2e%2e/site-secret/secret.txt'],
    ['a dotfile', '/.env'],
    ['a link that points out of the root', '/link.txt'],
  ])('refuses %s', async (_what, path) => {
    const r = await get(path);
    expect(r.status, `${path} answered ${r.status}`).not.toBe(200);
    expect(r.body).not.toContain('SECRET');
  });
});
