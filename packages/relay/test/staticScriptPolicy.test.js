/**
 * THE RELAY'S STATIC FILES CARRY A SCRIPT POLICY AND NO WILDCARD ORIGIN (the hostile-relay read, before the alpha).
 *
 * A page served from the relay's static root ran under no script policy, and every file went out with
 * `Access-Control-Allow-Origin: *`, so any web page anywhere could read whatever the root held. Now: no CORS header at
 * all (a page reads the relay's files only from the relay's own origin), and a script policy that lets scripts come
 * only from that origin, with no plugins, no foreign base and no framing. `nosniff` keeps a text file from being run.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { startRelay, STATIC_SCRIPT_POLICY } from '../src/server.js';

let relay; let base;
beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), 'relay-static-policy-'));
  mkdirSync(join(base, 'site'));
  writeFileSync(join(base, 'site', 'index.html'), '<p>hallo</p>');
  writeFileSync(join(base, 'site', 'app.js'), 'console.log(1)');
  relay = await startRelay({ port: 0, serveStaticDir: join(base, 'site') });
});
afterAll(async () => { await relay?.stop?.(); });

const get = (path, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port: relay.port, path, method: 'GET', headers }, (res) => {
    res.resume(); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
  });
  req.on('error', reject); req.end();
});

describe('the relay\'s static files', () => {
  it.each(['/index.html', '/app.js', '/'])('%s carries no wildcard origin, even when another site asks', async (path) => {
    const r = await get(path, { Origin: 'https://elsewhere.example' });
    expect(r.status).toBe(200);
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each(['/index.html', '/app.js'])('%s carries the script policy and nosniff', async (path) => {
    const r = await get(path);
    expect(r.headers['content-security-policy']).toBe(STATIC_SCRIPT_POLICY);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
  });

  it('the policy lets scripts come only from the relay\'s own origin, with no plugins, foreign base or framing', () => {
    const parts = Object.fromEntries(String(STATIC_SCRIPT_POLICY).split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
    expect(parts['script-src']).toEqual(["'self'"]);
    expect(parts['object-src']).toEqual(["'none'"]);
    expect(parts['base-uri']).toEqual(["'self'"]);
    expect(parts['frame-ancestors']).toEqual(["'none'"]);
  });
});
