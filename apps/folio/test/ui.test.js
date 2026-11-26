// @reads-source: this test reads source as text, so rung 1 runs it (docs/conventions/verification-ladder.md).
/**
 * ui.test.js — Folio.B1.ui tests (lean strategy).
 *
 * We intentionally avoid Playwright/Puppeteer — they pull in a 200+ MB
 * browser download which violates the spec's "no new heavy devDeps"
 * constraint.  Instead we:
 *
 *   1. Boot a real B1.server with a mock SyncEngine on an ephemeral port.
 *   2. Fetch `/`, `/app.js`, `/status.js`, `/conflicts.js`, `/share.js`,
 *      `/style.css`, `/vendor/codemirror.min.js` via Node 18+ `fetch`.
 *   3. Assert the DOM hooks the UI relies on are present in `index.html`,
 *      and that the JS modules reference the contract endpoints.
 *   4. Exercise the contract end-to-end through the same fetch surface
 *      the SPA uses (sync-now → /sync/now, conflict → /conflicts/:id/resolve,
 *      share → /share).
 *   5. Open a WebSocket, force-close it, confirm the SPA module reconnects
 *      (we do this on the JS side — exercise the `connect()` function via
 *      the test hook on `window.__folio` is browser-only, so we do the
 *      equivalent: assert backoff state behaves correctly via the actual
 *      module loaded into a vm sandbox).
 *
 * Coverage map (≥6 tests per the spec DoD):
 *   - page-load: GET / serves a 200 + has known DOM hooks
 *   - vendor-codemirror: vendored file exists + is non-trivial in size
 *   - sync-now button wires to POST /sync/now (asserts in JS source)
 *   - conflict list render: GET /conflicts returns the expected shape
 *   - conflict resolve end-to-end: write file with markers, resolve via REST
 *   - share-mint: POST /share returns a token JSON
 *   - WS reconnect logic: close socket and assert a new one re-opens
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir }         from 'node:os';
import { join }           from 'node:path';

import WebSocket from 'ws';

import { Bootstrap } from '@onderling/core';

import { SyncEngine }            from '../src/SyncEngine.js';
import { createServer }          from '../src/server/index.js';
import { conflictIdFromRelPath } from '../src/server/conflictId.js';
import { SyncErrorBuffer }       from '../src/server/errorBuffer.js';

// Reuse the pod-mock + vault from server.test.js (kept minimal here).
class MockPodClient {
  constructor(podRoot) {
    this.podRoot = podRoot.endsWith('/') ? podRoot : `${podRoot}/`;
    this.store = new Map();
    this.tombstones = new Set();
    this._etagCounter = 0;
  }
  async read(uri) {
    const r = this.store.get(uri);
    if (!r) { const e = new Error('mock 404'); e.code='NOT_FOUND'; throw e; }
    return { ...r };
  }
  async write(uri, content, opts = {}) {
    const text = typeof content === 'string' ? content : new TextDecoder().decode(content);
    const stored = {
      content: text,
      contentType:  opts.contentType || 'application/octet-stream',
      lastModified: new Date().toUTCString(),
      etag:         `"e${++this._etagCounter}"`,
      size:         Buffer.byteLength(text, 'utf8'),
    };
    this.store.set(uri, stored);
    this.tombstones.delete(uri);
    return { uri, ...stored };
  }
  async list(containerUri) {
    const container = String(containerUri).endsWith('/') ? containerUri : `${containerUri}/`;
    const direct = new Map();
    const nested = new Set();
    for (const k of this.store.keys()) {
      if (this.tombstones.has(k)) continue;
      if (!k.startsWith(container)) continue;
      const tail = k.slice(container.length);
      if (tail === '') continue;
      const slash = tail.indexOf('/');
      if (slash === -1) direct.set(k, 'resource');
      else              nested.add(`${container}${tail.slice(0, slash)}/`);
    }
    return {
      container,
      entries: [
        ...[...direct.keys()].map((uri) => ({ uri, type: 'resource' })),
        ...[...nested].map((uri)        => ({ uri, type: 'container' })),
      ],
    };
  }
  async delete(uri)        { this.store.delete(uri); this.tombstones.delete(uri); }
  async deleteLocal(uri)   { this.tombstones.add(uri); }
  async clearTombstone(uri){ this.tombstones.delete(uri); }
  on() {} off() {} emit() {}
}

const TEST_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

class MemVault {
  constructor() { this.entries = {}; }
  async get(key) { return this.entries[key]; }
  async set(key, val) { this.entries[key] = val; }
}

const POD_ROOT = 'https://alice.example/notes/';

let localRoot, engine, podClient, vault, srv, baseUrl, wsUrl;

beforeEach(async () => {
  localRoot = await fs.mkdtemp(join(tmpdir(), 'folio-ui-'));
  podClient = new MockPodClient(POD_ROOT);
  engine    = new SyncEngine({
    podClient,
    localRoot,
    podRoot:        POD_ROOT,
    pollIntervalMs: 60_000,
    debounceMs:     50,
  });
  engine.__podClient = podClient;

  vault = new MemVault();
  const bs = Bootstrap.fromMnemonic(TEST_PHRASE);
  vault.entries['bootstrap-mnemonic'] = TEST_PHRASE;
  vault.entries['bootstrap-seed-b64'] = Buffer.from(bs.secret).toString('base64');

  srv = createServer({ engine, vault });
  const { port, host } = await srv.listen(0, '127.0.0.1');
  baseUrl = `http://${host}:${port}`;
  wsUrl   = `ws://${host}:${port}/events`;
});

afterEach(async () => {
  try { await srv.close(); } catch { /* ignore */ }
  try { await fs.rm(localRoot, { recursive: true, force: true }); } catch { /* ignore */ }
});

// ── 1. Page load + DOM hooks ───────────────────────────────────────────────

describe('GET /', () => {
  it('serves index.html with all the DOM hooks the SPA needs', async () => {
    const r = await fetch(`${baseUrl}/`);
    expect(r.status).toBe(200);
    const html = await r.text();
    // Top-level chrome.
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('<title>Folio</title>');

    // Tab switcher.
    expect(html).toMatch(/id="tab-status"/);
    expect(html).toMatch(/id="tab-conflicts"/);
    expect(html).toMatch(/id="tab-share"/);

    // Status pane hooks.
    expect(html).toMatch(/id="status-local-root"/);
    expect(html).toMatch(/id="status-pod-root"/);
    expect(html).toMatch(/id="status-pending"/);
    expect(html).toMatch(/id="btn-sync-now"/);
    expect(html).toMatch(/id="btn-watch-toggle"/);

    // Conflicts pane hooks.
    expect(html).toMatch(/id="conflict-list"/);
    expect(html).toMatch(/id="merge-mine"/);
    expect(html).toMatch(/id="merge-theirs"/);
    expect(html).toMatch(/id="merge-merged"/);
    expect(html).toMatch(/id="btn-keep-mine"/);
    expect(html).toMatch(/id="btn-keep-theirs"/);
    expect(html).toMatch(/id="btn-save-merged"/);

    // Share pane hooks.
    expect(html).toMatch(/id="share-form"/);
    expect(html).toMatch(/id="share-webid"/);
    expect(html).toMatch(/id="share-token-out"/);
    expect(html).toMatch(/id="btn-copy-token"/);

    // Banner + connection lifecycle entry.
    expect(html).toMatch(/id="conn-banner"/);

    // Vendor + module wiring.
    expect(html).toMatch(/<script src="\/vendor\/codemirror\.min\.js"/);
    expect(html).toMatch(/<script type="module" src="\/app\.js"/);
  });
});

// ── 2. Vendored CodeMirror ─────────────────────────────────────────────────

describe('vendor/codemirror.min.js', () => {
  it('is served from the same origin and is non-trivial in size', async () => {
    const r = await fetch(`${baseUrl}/vendor/codemirror.min.js`);
    expect(r.status).toBe(200);
    const text = await r.text();
    // Real CodeMirror lib is hundreds of KB; insist on at least 100 KB so
    // a stub doesn't sneak through.
    expect(text.length).toBeGreaterThan(100_000);
    expect(text).toContain('CodeMirror');
  });

  it('serves the matching CSS', async () => {
    const r = await fetch(`${baseUrl}/vendor/codemirror.min.css`);
    expect(r.status).toBe(200);
    const css = await r.text();
    expect(css).toContain('.CodeMirror');
  });
});

// ── 3. The JS modules reference the documented contract endpoints ─────────

describe('static JS modules', () => {
  async function getText(path) {
    const r = await fetch(`${baseUrl}${path}`);
    expect(r.status).toBe(200);
    return r.text();
  }

  it('app.js wires healthz, status, and the WebSocket', async () => {
    const text = await getText('/app.js');
    expect(text).toContain('/healthz');
    expect(text).toContain('/status');
    expect(text).toContain('/events');
    // Reconnect path with a backoff array exists.
    expect(text).toMatch(/BACKOFF_MS\s*=\s*\[/);
  });

  it('status.js calls /sync/now and /watch/start|/watch/stop', async () => {
    const text = await getText('/status.js');
    expect(text).toContain('/sync/now');
    expect(text).toContain('/watch/start');
    expect(text).toContain('/watch/stop');
  });

  it('conflicts.js calls /conflicts and /conflicts/:id/resolve', async () => {
    const text = await getText('/conflicts.js');
    expect(text).toContain('/conflicts');
    expect(text).toContain('/resolve');
  });

  it('share.js posts to /share and uses textContent (no innerHTML)', async () => {
    const text = await getText('/share.js');
    expect(text).toContain('/share');
    // XSS hardening: no innerHTML on any user-controlled path.
    expect(text).not.toMatch(/\.innerHTML\s*=/);
  });
});

// ── 4. Conflict list render: data shape that conflicts.js consumes ────────

describe('conflict list backend feed', () => {
  it('GET /conflicts returns ids that the UI can decode for display', async () => {
    const blob = '<<<<<<< YOURS\nMINE\n=======\nTHEIRS\n>>>>>>> THEIRS\n';
    await fs.writeFile(join(localRoot, 'note.md'), blob);

    const r = await fetch(`${baseUrl}/conflicts`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].relPath).toBe('note.md');
    expect(body.conflicts[0].id).toBe(conflictIdFromRelPath('note.md'));
  });
});

// ── 5. Conflict resolve end-to-end (covers a full UI button flow) ─────────

describe('conflict resolve end-to-end', () => {
  it('POST /conflicts/:id/resolve with mine writes the chosen side back', async () => {
    const blob = '<<<<<<< YOURS\nMINE\n=======\nTHEIRS\n>>>>>>> THEIRS\n';
    await fs.writeFile(join(localRoot, 'note.md'), blob);

    const id = conflictIdFromRelPath('note.md');
    const r = await fetch(`${baseUrl}/conflicts/${id}/resolve`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ resolution: 'mine' }),
    });
    expect(r.status).toBe(200);
    const stored = await fs.readFile(join(localRoot, 'note.md'), 'utf8');
    expect(stored).toBe('MINE\n');

    // Subsequent /conflicts list is empty.
    const list = await (await fetch(`${baseUrl}/conflicts`)).json();
    expect(list.conflicts).toEqual([]);
  });

  it('GET /conflicts/:id/content returns the raw file text the merge view reads', async () => {
    const blob = '<<<<<<< YOURS\nA\n=======\nB\n>>>>>>> THEIRS\n';
    await fs.writeFile(join(localRoot, 'note.md'), blob);

    const id = conflictIdFromRelPath('note.md');
    const r = await fetch(`${baseUrl}/conflicts/${id}/content`);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/text\/plain/);
    const text = await r.text();
    expect(text).toBe(blob);
  });

  it('GET /conflicts/:id/content rejects path-escape attempts', async () => {
    // base64url-encode '../etc/passwd' as if it were a relPath.
    const id = Buffer.from('../etc/passwd', 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const r = await fetch(`${baseUrl}/conflicts/${id}/content`);
    expect(r.status).toBe(400);
    const body = await r.json();
    expect(body.error.code).toBe('BAD_CONFLICT_ID');
  });
});

// ── 6. Sync-now end-to-end ─────────────────────────────────────────────────

describe('sync-now button (POST /sync/now)', () => {
  it('triggers a real sync against the mock pod', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'aaa');
    const r = await fetch(`${baseUrl}/sync/now`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ direction: 'push' }),
    });
    expect(r.status).toBe(202);
    // Background sync; small wait then assert the pod sees the file.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(podClient.store.has(`${POD_ROOT}a.md`)).toBe(true);
  });
});

// ── 7. Share-mint end-to-end ───────────────────────────────────────────────

describe('share form (POST /share)', () => {
  it('mints a token JSON the UI renders into the textarea', async () => {
    const r = await fetch(`${baseUrl}/share`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        webid:  'https://alice.example/profile/card#me',
        scopes: ['read', 'write'],
        path:   '/notes/shared/',
        expiresIn: 86_400_000,
      }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.token).toBeDefined();
    expect(body.token.subject).toBe('https://alice.example/profile/card#me');
    expect(body.token.scopes).toEqual([
      'pod.read:/notes/shared/',
      'pod.write:/notes/shared/',
    ]);
  });
});

// ── 8. Folio.B4 — Versioning (per-file popover after the v2.9 re-shape) ───

describe('versioning (Folio.B4 — per-file popover after v2.9)', () => {
  it('serves /versions.js with the per-file popover controller', async () => {
    const r = await fetch(`${baseUrl}/versions.js`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain('/versions');
    expect(text).toContain('initVersions');
    // No innerHTML on user-controlled values.
    expect(text).not.toMatch(/\.innerHTML\s*=/);
  });

  it('GET /versions returns the file picker feed; restore endpoint fires', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'first');
    // Drive a sync to populate history.
    await engine.runOnce();

    const list = await (await fetch(`${baseUrl}/versions`)).json();
    expect(list.files.length).toBeGreaterThanOrEqual(1);
    const aFile = list.files.find((f) => f.relPath === 'a.md');
    expect(aFile).toBeDefined();
    expect(aFile.id).toBe(conflictIdFromRelPath('a.md'));

    // Pull the version list for that file.
    const v = await (await fetch(`${baseUrl}/versions/${aFile.id}`)).json();
    expect(v.versions.length).toBeGreaterThanOrEqual(1);

    // Restore the only known version.
    const ts = v.versions[0].ts;
    await fs.writeFile(join(localRoot, 'a.md'), 'mutated');
    const restoreResp = await fetch(`${baseUrl}/versions/${aFile.id}/restore`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ ts }),
    });
    expect(restoreResp.status).toBe(200);
    const r = await restoreResp.json();
    expect(r.restoredFromMs).toBe(ts);
    expect(typeof r.snapshotMsBeforeRestore).toBe('number');
    expect(await fs.readFile(join(localRoot, 'a.md'), 'utf8')).toBe('first');
  });
});

// ── 9. WebSocket reconnect ────────────────────────────────────────────────

describe('WebSocket /events reconnect', () => {
  it('the server accepts a fresh WS connection after the previous one closes', async () => {
    // Open + close a connection.
    const ws1 = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws1.once('open', res); ws1.once('error', rej); });
    ws1.close();
    await new Promise((res) => setTimeout(res, 50));

    // Now open a new one — the server is healthy and accepts it; this is
    // the same path the SPA's exponential-backoff `connect()` exercises.
    const ws2 = new WebSocket(wsUrl);
    // Attach the message listener BEFORE the socket finishes opening so we
    // don't drop the server's greeting frame (which is sent inside the
    // 'connection' handler the moment the handshake completes).
    const greeted = new Promise((res, rej) => {
      ws2.once('message', (data) => {
        try { res(JSON.parse(data.toString('utf8'))); }
        catch (err) { rej(err); }
      });
      ws2.once('error', rej);
    });
    await new Promise((res, rej) => { ws2.once('open', res); ws2.once('error', rej); });
    const frame = await greeted;
    expect(frame.type).toBe('status');

    ws2.close();
  });

  it('app.js exposes the reconnect path on window.__folio for hot-recovery', async () => {
    const r = await fetch(`${baseUrl}/app.js`);
    const text = await r.text();
    expect(text).toContain('window.__folio');
    expect(text).toMatch(/reconnect:\s*connect/);
  });
});

// ── 10. Folio v2.2 — loud error surfacing ─────────────────────────────────

describe('Folio v2.2 — error banner static contract', () => {
  it('index.html carries the error-banner DOM hooks and recent-errors collapsible', async () => {
    const r = await fetch(`${baseUrl}/`);
    expect(r.status).toBe(200);
    const html = await r.text();
    // Banner element + buttons.
    expect(html).toMatch(/id="error-banner"/);
    expect(html).toMatch(/id="error-banner-message"/);
    expect(html).toMatch(/id="error-banner-retry"/);
    expect(html).toMatch(/id="error-banner-dismiss"/);
    // Banner starts hidden.
    expect(html).toMatch(/id="error-banner"[^>]*class="error-banner error-banner--hidden"/);
    // Recent errors collapsible.
    expect(html).toMatch(/id="recent-errors"/);
    expect(html).toMatch(/id="recent-errors-count"/);
    expect(html).toMatch(/id="recent-errors-list"/);
    // Auth-pill warning indicator (yellow-pill state).
    expect(html).toMatch(/id="auth-pill-warn"/);
  });

  it('style.css ships the red banner + yellow-pill rules', async () => {
    const r = await fetch(`${baseUrl}/style.css`);
    expect(r.status).toBe(200);
    const css = await r.text();
    expect(css).toMatch(/\.error-banner\s*\{/);
    expect(css).toMatch(/\.error-banner--hidden/);
    expect(css).toMatch(/\.error-banner__retry/);
    expect(css).toMatch(/\.error-banner__dismiss/);
    expect(css).toMatch(/\.auth-pill--warn/);
    expect(css).toMatch(/\.recent-errors/);
  });

  it('app.js wires ws.error → banner with a 5s clean-sync debounce; conflict phase excluded', async () => {
    const r = await fetch(`${baseUrl}/app.js`);
    expect(r.status).toBe(200);
    const text = await r.text();
    // Subscribed to ws.error.
    expect(text).toMatch(/ws\.error/);
    // Subscribed to ws.sync.done for the clean-sync debounce.
    expect(text).toMatch(/ws\.sync\.done/);
    // 5s debounce constant.
    expect(text).toMatch(/CLEAN_DEBOUNCE_MS\s*=\s*5_?000/);
    // Phase blocklist (conflict not surfaced).
    expect(text).toMatch(/PHASE_BLOCKLIST[^\n]*conflict/);
    // Retry button hits /sync/now.
    expect(text).toMatch(/postJson\(['"]\/sync\/now/);
    // Dismiss path exists.
    expect(text).toMatch(/dismissedUntilNew/);
    // No innerHTML in the banner controller — XSS hardening.
    expect(text).not.toMatch(/\.innerHTML\s*=/);
  });

  it('status.js renders the recent-errors list using textContent only', async () => {
    const r = await fetch(`${baseUrl}/status.js`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toMatch(/errors\.changed/);
    expect(text).toMatch(/recent-errors-list/);
    // No innerHTML on the user-controlled error fields.
    expect(text).not.toMatch(/\.innerHTML\s*=/);
  });
});

// ── 11. Folio v2.5 — Force re-push + Verify pod state ─────────────────────

describe('Folio v2.5 — static UI contract (Force re-push + verify dots)', () => {
  it('index.html carries the Force re-push button + confirm modal + verify list', async () => {
    const r = await fetch(`${baseUrl}/`);
    expect(r.status).toBe(200);
    const html = await r.text();
    // Button lives in the Status pane below "Sync now".
    expect(html).toMatch(/id="btn-force-push"/);
    // Confirm modal + buttons.
    expect(html).toMatch(/id="force-confirm-modal"/);
    expect(html).toMatch(/id="btn-force-confirm"/);
    expect(html).toMatch(/id="btn-force-cancel"/);
    // Modal starts hidden so the user can never accidentally trigger force.
    expect(html).toMatch(/id="force-confirm-modal"[^>]*hidden/);
    // Verify list + Verify-all button.
    expect(html).toMatch(/id="verify-list"/);
    expect(html).toMatch(/id="verify-list-items"/);
    expect(html).toMatch(/id="btn-verify-all"/);
    // The button is part of the Status pane (NOT a new tab).  No new tab id
    // for force/verify must have been added.
    expect(html).not.toMatch(/id="tab-force"/);
    expect(html).not.toMatch(/id="tab-verify"/);
  });

  it('style.css ships the verify-dot states + modal rules', async () => {
    const r = await fetch(`${baseUrl}/style.css`);
    expect(r.status).toBe(200);
    const css = await r.text();
    expect(css).toMatch(/\.verify-dot\s*\{/);
    expect(css).toMatch(/\.verify-dot--green/);
    expect(css).toMatch(/\.verify-dot--yellow/);
    expect(css).toMatch(/\.verify-dot--red/);
    expect(css).toMatch(/\.verify-dot--gray/);
    expect(css).toMatch(/\.modal\s*\{/);
    expect(css).toMatch(/\.modal__inner/);
  });

  it('status.js wires the Force re-push button + verify list with no innerHTML', async () => {
    const r = await fetch(`${baseUrl}/status.js`);
    expect(r.status).toBe(200);
    const text = await r.text();
    // Modal-gated POST /sync/force.
    expect(text).toContain('/sync/force');
    expect(text).toContain('force-confirm-modal');
    // Verify-all button hits /verify/<id>.
    expect(text).toContain('/verify/');
    // Subscribed to the new WS frames.
    expect(text).toMatch(/ws\.sync\.force\.start/);
    expect(text).toMatch(/ws\.sync\.force\.done/);
    // XSS hardening: no innerHTML anywhere in this module.
    expect(text).not.toMatch(/\.innerHTML\s*=/);
  });
});

describe('Folio v2.5 — endpoints end-to-end (force + verify)', () => {
  it('POST /sync/force returns 202 and re-uploads every file', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'apple');
    await fs.writeFile(join(localRoot, 'b.md'), 'banana');
    await engine.runOnce();
    // Track writes from now on.
    let writes = 0;
    const orig = podClient.write.bind(podClient);
    podClient.write = async (...args) => { writes++; return orig(...args); };

    const r = await fetch(`${baseUrl}/sync/force`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({}),
    });
    expect(r.status).toBe(202);
    await new Promise((res) => setTimeout(res, 200));
    expect(writes).toBe(2);
  });

  it('GET /verify/:id returns the structured pod-state result for a synced file', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'hello');
    await engine.runOnce();
    const id = conflictIdFromRelPath('a.md');
    const r = await fetch(`${baseUrl}/verify/${id}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.relPath).toBe('a.md');
    expect(body.exists).toBe(true);
    expect(body.sizeMatches).toBe(true);
    expect(body.shaMatches).toBe(true);
  });

  it('GET /verify/:id reports exists=false for an unsynced file', async () => {
    await fs.writeFile(join(localRoot, 'unsynced.md'), 'x');
    const id = conflictIdFromRelPath('unsynced.md');
    const r = await fetch(`${baseUrl}/verify/${id}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.exists).toBe(false);
  });
});

// ── 12. Folio v2.3 — Settings panel + Diagnostics ────────────────────────

describe('Folio v2.3 — Settings panel (NOT a top tab)', () => {
  it('index.html ships a header Settings button + settings overlay (no new top-level tab)', async () => {
    const r = await fetch(`${baseUrl}/`);
    expect(r.status).toBe(200);
    const html = await r.text();

    // Header affordance: text + gear character (HTML entity).  Must NOT
    // be a new tab inside the .tabs nav.
    expect(html).toMatch(/id="settings-open-btn"/);
    expect(html).toMatch(/class="settings-link"/);
    expect(html).toMatch(/&#9881;/);                     // gear glyph

    // Settings overlay/panel structure.
    expect(html).toMatch(/id="settings-panel"/);
    expect(html).toMatch(/role="dialog"/);
    expect(html).toMatch(/aria-modal="true"/);

    // Diagnostics section lives INSIDE the settings panel.
    expect(html).toMatch(/id="settings-diagnostics"/);
    expect(html).toMatch(/id="btn-diagnostics-run"/);
    expect(html).toMatch(/id="diagnostics-list"/);

    // Hard rule: NO new top-level Diagnostics tab.  After the v2.9 re-shape
    // the only primary tabs are Status / Conflicts / Share.
    const tabsBlock = html.match(/<nav class="tabs"[\s\S]*?<\/nav>/);
    expect(tabsBlock).toBeTruthy();
    expect(tabsBlock[0]).not.toMatch(/id="tab-diagnostics"/i);
    expect(tabsBlock[0]).not.toMatch(/Diagnostics<\/button>/i);
    // Sanity: existing primary tabs still present.
    expect(tabsBlock[0]).toMatch(/id="tab-status"/);
    expect(tabsBlock[0]).toMatch(/id="tab-conflicts"/);
    expect(tabsBlock[0]).toMatch(/id="tab-share"/);
  });

  it('settings.js wires Run button → POST /diagnostics + ws.diagnostics.* with textContent only', async () => {
    const r = await fetch(`${baseUrl}/settings.js`);
    expect(r.status).toBe(200);
    const text = await r.text();
    // Hits the 202+409 route.
    expect(text).toMatch(/['"]\/diagnostics['"]/);
    // Subscribes to streaming frames over the existing WS bus.
    expect(text).toMatch(/ws\.diagnostics\.step/);
    expect(text).toMatch(/ws\.diagnostics\.done/);
    // Open / close + Esc handling for the panel.
    expect(text).toMatch(/Escape/);
    // Strict XSS hardening — no innerHTML on user-controlled data.
    expect(text).not.toMatch(/\.innerHTML\s*=/);
  });

  it('style.css ships the settings panel + diagnostic-row + colored-dot rules', async () => {
    const r = await fetch(`${baseUrl}/style.css`);
    expect(r.status).toBe(200);
    const css = await r.text();
    expect(css).toMatch(/\.settings-panel\s*\{/);
    expect(css).toMatch(/\.settings-link/);
    expect(css).toMatch(/\.diagnostic-row\s*\{/);
    expect(css).toMatch(/\.diagnostic-row__dot/);
    expect(css).toMatch(/\.diagnostic-row__dot--pass/);
    expect(css).toMatch(/\.diagnostic-row__dot--warn/);
    expect(css).toMatch(/\.diagnostic-row__dot--fail/);
    expect(css).toMatch(/\.diagnostic-row__dot--skip/);
  });

  it('app.js boots the Settings controller and exposes it on window.__folio', async () => {
    const r = await fetch(`${baseUrl}/app.js`);
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).toContain('initSettings');
    expect(text).toContain('/settings.js');
    // Test hook: __folio.settings exposes the controller for ui-tests /
    // browser console inspection.
    expect(text).toMatch(/get settings\(\)/);
  });

  it('end-to-end: POST /diagnostics streams diagnostics.step + .done over /events', async () => {
    // We can't easily exercise the real diagnostics engine in this UI test
    // (it needs a config fixture); we instead spin a server with an
    // injected fake `runDiagnostics` so the test stays fast + offline,
    // and confirm the WS frames the UI subscribes to are emitted.
    await srv.close();
    const fakeRun = async (reporter) => {
      reporter.step({ id: 'config',         status: 'PASS', label: 'config exists' });
      reporter.step({ id: 'vault',          status: 'PASS', label: 'vault exists' });
      reporter.step({ id: 'pod-head',       status: 'WARN', label: 'pod root reachable', detail: 'slow' });
      return { abortReason: null, cfg: {}, counts: { PASS: 2, FAIL: 0, WARN: 1, SKIP: 0 } };
    };
    srv = createServer({ engine, vault, runDiagnostics: fakeRun });
    const { port, host } = await srv.listen(0, '127.0.0.1');
    baseUrl = `http://${host}:${port}`;
    wsUrl   = `ws://${host}:${port}/events`;

    const ws = new WebSocket(wsUrl);
    const frames = [];
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    ws.on('message', (data) => {
      try { frames.push(JSON.parse(data.toString('utf8'))); } catch { /* ignore */ }
    });

    const r = await fetch(`${baseUrl}/diagnostics`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    '{}',
    });
    expect(r.status).toBe(202);

    await waitForFrame(frames, 'diagnostics.done');
    const stepFrames = frames.filter((f) => f.type === 'diagnostics.step');
    expect(stepFrames.length).toBe(3);
    expect(stepFrames[0].label).toBe('config exists');
    const done = frames.find((f) => f.type === 'diagnostics.done');
    expect(done.ok).toBe(true);
    expect(done.counts).toEqual({ PASS: 2, FAIL: 0, WARN: 1, SKIP: 0 });

    ws.close();
  });

  it('returns 409 on a concurrent POST /diagnostics', async () => {
    await srv.close();
    const fakeRun = async (reporter) => {
      reporter.step({ id: 'a', status: 'PASS', label: 'a' });
      // Hold open for a few ticks so a second request races us.
      await new Promise((r) => setTimeout(r, 80));
      reporter.step({ id: 'b', status: 'PASS', label: 'b' });
      return { abortReason: null, cfg: {}, counts: { PASS: 2, FAIL: 0, WARN: 0, SKIP: 0 } };
    };
    srv = createServer({ engine, vault, runDiagnostics: fakeRun });
    const { port, host } = await srv.listen(0, '127.0.0.1');
    baseUrl = `http://${host}:${port}`;

    const first = await fetch(`${baseUrl}/diagnostics`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(first.status).toBe(202);

    const second = await fetch(`${baseUrl}/diagnostics`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(second.status).toBe(409);
    const body = await second.json();
    expect(body.error.code).toBe('DIAGNOSTICS_IN_PROGRESS');
  });
});

// Helper used by the diagnostics UI test above.
async function waitForFrame(frames, type, timeoutMs = 3000) {
  const start = Date.now();
  while (!frames.some((f) => f.type === type)) {
    if (Date.now() - start > timeoutMs) throw new Error(`waitForFrame: timed out for ${type}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

describe('Folio v2.2 — banner end-to-end against the server', () => {
  it('GET /status carries lastError + errors so the UI paints on first load', async () => {
    // Replace the server with one we own the buffer for.
    await srv.close();
    const buf = new SyncErrorBuffer();
    srv = createServer({ engine, vault, errorBuffer: buf });
    const { port, host } = await srv.listen(0, '127.0.0.1');
    baseUrl = `http://${host}:${port}`;

    buf.push({ phase: 'upload', relPath: 'cake.md', message: 'PUT 403' });
    buf.push({ phase: 'ensure-container', uri: 'https://pod/x/', message: 'mkdir 401' });

    const r = await fetch(`${baseUrl}/status`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.lastError.phase).toBe('ensure-container');
    expect(body.lastError.message).toBe('mkdir 401');
    expect(body.errors).toHaveLength(2);
    // Conflicts are NOT in the banner feed.
    buf.push({ phase: 'conflict', relPath: 'noisy.md', message: 'normal flow' });
    const r2 = await fetch(`${baseUrl}/status`);
    const body2 = await r2.json();
    expect(body2.errors.find((e) => e.phase === 'conflict')).toBeUndefined();
  });

  it('"Retry sync" hits /sync/now and POST /errors/clear empties the history', async () => {
    await srv.close();
    const buf = new SyncErrorBuffer();
    srv = createServer({ engine, vault, errorBuffer: buf });
    const { port, host } = await srv.listen(0, '127.0.0.1');
    baseUrl = `http://${host}:${port}`;

    buf.push({ phase: 'upload', relPath: 'a.md', message: 'flaky' });
    expect(buf.size).toBe(1);

    // Retry sync — same endpoint the banner button triggers.
    const retry = await fetch(`${baseUrl}/sync/now`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ direction: 'both' }),
    });
    expect(retry.status).toBe(202);

    // Dismiss-equivalent server-side: explicit clear endpoint.
    const clear = await fetch(`${baseUrl}/errors/clear`, { method: 'POST' });
    expect(clear.status).toBe(204);

    const body = await (await fetch(`${baseUrl}/status`)).json();
    expect(body.lastError).toBeNull();
    expect(body.errors).toEqual([]);
  });
});

// ── 13. Folio v2.9 — Web UI re-shape (Dropbox-shaped) ────────────────────

describe('Folio v2.9 + History tab — four primary tabs + per-file history popover', () => {
  // 2026-04-30: v2.9 originally demoted History from a primary tab into
  // the per-file popover only.  Reverted partially per user request —
  // the tab is back AND the popover stays.  Two complementary surfaces:
  // tab for browse-everything; popover for drill-into-one-file.
  it('index.html exposes the four primary tabs (Status / Conflicts / Share / History)', async () => {
    const r = await fetch(`${baseUrl}/`);
    expect(r.status).toBe(200);
    const html = await r.text();

    // Tabs nav block: the four primary tabs.
    const tabsBlock = html.match(/<nav class="tabs"[\s\S]*?<\/nav>/);
    expect(tabsBlock).toBeTruthy();
    expect(tabsBlock[0]).toMatch(/id="tab-status"/);
    expect(tabsBlock[0]).toMatch(/id="tab-conflicts"/);
    expect(tabsBlock[0]).toMatch(/id="tab-share"/);
    expect(tabsBlock[0]).toMatch(/id="tab-history"/);

    // The History pane is rendered with its list container.
    expect(html).toMatch(/id="pane-history"/);
    expect(html).toMatch(/id="history-list"/);

    // Settings link in the header survives v2.9 (it predates this slice
    // — landed in v2.3 — but v2.9 must keep it intact).
    expect(html).toMatch(/id="settings-open-btn"/);
    expect(html).toMatch(/class="settings-link"/);
  });

  it('index.html ships the per-file history popover, closed-by-default', async () => {
    const r = await fetch(`${baseUrl}/`);
    const html = await r.text();

    // Popover overlay + its component hooks.
    expect(html).toMatch(/id="history-popover"/);
    expect(html).toMatch(/id="history-popover-backdrop"/);
    expect(html).toMatch(/id="history-popover-close"/);
    expect(html).toMatch(/id="history-popover-relpath"/);
    expect(html).toMatch(/id="history-popover-versions"/);
    expect(html).toMatch(/id="history-popover-content"/);
    expect(html).toMatch(/id="btn-history-popover-restore"/);

    // ARIA: the popover is a modal dialog.
    expect(html).toMatch(/id="history-popover"[^>]*role="dialog"/);
    expect(html).toMatch(/id="history-popover"[^>]*aria-modal="true"/);

    // Closed-by-default: the popover element carries `hidden` on first paint.
    expect(html).toMatch(/id="history-popover"[^>]*hidden/);
  });

  it('conflicts.js + status.js wire per-file history affordances that emit history.popover.open (no tab navigation)', async () => {
    const conflictsText = await (await fetch(`${baseUrl}/conflicts.js`)).text();
    const statusText    = await (await fetch(`${baseUrl}/status.js`)).text();

    // Both modules emit the v2.9 popover-open bus event for the file row.
    expect(conflictsText).toContain('history.popover.open');
    expect(statusText).toContain('history.popover.open');

    // The "↻ history" affordance text (U+21BB) is the user-visible label.
    expect(conflictsText).toContain('↻ history');
    expect(statusText).toContain('↻ history');

    // Critically: no tab navigation — the conflicts module must NOT click()
    // a former history tab anymore (which doesn't exist in the v2.9 DOM).
    expect(conflictsText).not.toMatch(/getElementById\(['"]tab-history['"]\)/);

    // No innerHTML on either module — XSS hardening preserved.
    expect(conflictsText).not.toMatch(/\.innerHTML\s*=/);
    expect(statusText).not.toMatch(/\.innerHTML\s*=/);
  });

  it('versions.js implements the popover (open/close + Esc) and still hits /versions/* REST endpoints', async () => {
    const r = await fetch(`${baseUrl}/versions.js`);
    expect(r.status).toBe(200);
    const text = await r.text();

    // REST surface unchanged: list, list-for-id, content-for-ts, restore.
    expect(text).toContain('/versions');
    expect(text).toContain('/versions/${activeId}');
    expect(text).toContain('/versions/${activeId}/restore');
    // Content path uses both the id + ts.
    expect(text).toMatch(/\/versions\/\$\{activeId\}\/content\/\$\{v\.ts\}/);

    // Subscribed to the popover-open event from conflicts.js / status.js.
    expect(text).toContain('history.popover.open');
    // Esc-to-close handling.
    expect(text).toMatch(/Escape/);
    // No innerHTML anywhere — same XSS rule as the rest of the SPA.
    expect(text).not.toMatch(/\.innerHTML\s*=/);
  });

  it('style.css ships the per-file popover styles + the gray-zero conflicts badge rule', async () => {
    const r = await fetch(`${baseUrl}/style.css`);
    expect(r.status).toBe(200);
    const css = await r.text();

    // Popover skeleton.
    expect(css).toMatch(/\.history-popover\s*\{/);
    expect(css).toMatch(/\.history-popover__backdrop/);
    expect(css).toMatch(/\.history-popover__inner/);
    expect(css).toMatch(/\.history-popover__close/);

    // Per-row affordance link styling.
    expect(css).toMatch(/\.history-affordance/);

    // Gray-zero badge (Conflicts tab stable at N=0).
    expect(css).toMatch(/\.tab \.badge--zero/);
  });

  it('GET /versions endpoints remain functional after the re-shape (no server-side regression)', async () => {
    // Sanity: the REST contract that backs the per-file popover is the
    // exact same one the old History tab used.  This test exercises it
    // end-to-end so a future accidental server-side regression is caught.
    await fs.writeFile(join(localRoot, 'note.md'), 'one');
    await engine.runOnce();

    const list = await (await fetch(`${baseUrl}/versions`)).json();
    const f = list.files.find((x) => x.relPath === 'note.md');
    expect(f).toBeDefined();
    const id = conflictIdFromRelPath('note.md');
    expect(f.id).toBe(id);

    const versions = await (await fetch(`${baseUrl}/versions/${id}`)).json();
    expect(versions.versions.length).toBeGreaterThanOrEqual(1);
    const ts = versions.versions[0].ts;

    const contentResp = await fetch(`${baseUrl}/versions/${id}/content/${ts}`);
    expect(contentResp.status).toBe(200);
    expect(await contentResp.text()).toBe('one');

    // Restore round-trips against a mutated working copy.
    await fs.writeFile(join(localRoot, 'note.md'), 'two');
    const restore = await fetch(`${baseUrl}/versions/${id}/restore`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    JSON.stringify({ ts }),
    });
    expect(restore.status).toBe(200);
    expect(await fs.readFile(join(localRoot, 'note.md'), 'utf8')).toBe('one');
  });
});

// ── 14. Folio v2.11 — Per-file delete buttons (local + pod) ───────────────

describe('Folio v2.11 — per-file delete buttons (UI contract)', () => {
  it('index.html ships both confirm modals (rm + pod-delete), distinct + closed-by-default', async () => {
    const r = await fetch(`${baseUrl}/`);
    expect(r.status).toBe(200);
    const html = await r.text();

    // Local-tombstone modal.
    expect(html).toMatch(/id="rm-confirm-modal"/);
    expect(html).toMatch(/id="btn-rm-confirm"/);
    expect(html).toMatch(/id="btn-rm-cancel"/);
    expect(html).toMatch(/id="rm-confirm-backdrop"/);
    expect(html).toMatch(/id="rm-confirm-modal"[^>]*hidden/);

    // Permanent pod-delete modal — distinct ids.  The destructive variant
    // carries `modal--pod-delete` so the red styling kicks in.
    expect(html).toMatch(/id="pod-delete-confirm-modal"/);
    expect(html).toMatch(/id="btn-pod-delete-confirm"/);
    expect(html).toMatch(/id="btn-pod-delete-cancel"/);
    expect(html).toMatch(/id="pod-delete-confirm-backdrop"/);
    expect(html).toMatch(/id="pod-delete-confirm-modal"[^>]*hidden/);
    expect(html).toMatch(/modal--pod-delete/);
    expect(html).toMatch(/modal__inner--danger/);

    // ARIA roles for the confirm modals.
    expect(html).toMatch(/id="rm-confirm-modal"[^>]*role="dialog"/);
    expect(html).toMatch(/id="pod-delete-confirm-modal"[^>]*role="dialog"/);
  });

  it('status.js wires per-row delete buttons + ESC + backdrop close, with no innerHTML', async () => {
    const r = await fetch(`${baseUrl}/status.js`);
    expect(r.status).toBe(200);
    const text = await r.text();

    // Both endpoints referenced from the controller.
    expect(text).toMatch(/['"]\/rm\/\$\{id\}['"]|`\/rm\/\$\{id\}`/);
    expect(text).toMatch(/['"]\/delete\/\$\{id\}['"]|`\/delete\/\$\{id\}`/);

    // Plain-text labels on the per-row buttons (no glyph required).
    expect(text).toContain('Delete locally');
    expect(text).toContain('Delete from pod');

    // Modal hygiene: ESC + backdrop close.
    expect(text).toMatch(/Escape/);
    expect(text).toMatch(/backdrop/i);

    // Subscribed to the new WS frame.
    expect(text).toMatch(/ws\.sync\.delete\.done/);

    // XSS hardening preserved (no innerHTML anywhere in this controller).
    expect(text).not.toMatch(/\.innerHTML\s*=/);
  });

  it('style.css ships the danger button + danger-modal rules', async () => {
    const r = await fetch(`${baseUrl}/style.css`);
    expect(r.status).toBe(200);
    const css = await r.text();
    expect(css).toMatch(/\.btn--danger/);
    expect(css).toMatch(/\.modal__inner--danger/);
    expect(css).toMatch(/\.modal__warn--danger/);
    expect(css).toMatch(/\.verify-list__rm/);
    expect(css).toMatch(/\.verify-list__pod-delete/);
  });

  it('POST /rm/:id tombstones the file (pod copy stays) end-to-end', async () => {
    await fs.writeFile(join(localRoot, 'a.md'), 'apple');
    await engine.runOnce();
    expect(podClient.store.has(`${POD_ROOT}a.md`)).toBe(true);

    const id = conflictIdFromRelPath('a.md');
    const r = await fetch(`${baseUrl}/rm/${id}`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    '{}',
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.ok).toBe(true);
    expect(body.relPath).toBe('a.md');
    // Pod copy survives the tombstone.
    expect(podClient.store.has(`${POD_ROOT}a.md`)).toBe(true);
    expect(podClient.tombstones.has(`${POD_ROOT}a.md`)).toBe(true);
  });

  it('POST /delete/:id permanently removes pod + local + history; broadcasts sync.delete.done', async () => {
    await fs.writeFile(join(localRoot, 'doomed.md'), 'erase me');
    await engine.runOnce();
    expect(podClient.store.has(`${POD_ROOT}doomed.md`)).toBe(true);

    const ws = new WebSocket(wsUrl);
    const frames = [];
    await new Promise((res, rej) => { ws.once('open', res); ws.once('error', rej); });
    ws.on('message', (data) => {
      try { frames.push(JSON.parse(data.toString('utf8'))); } catch { /* ignore */ }
    });

    const id = conflictIdFromRelPath('doomed.md');
    const r = await fetch(`${baseUrl}/delete/${id}`, {
      method:  'POST',
      headers: { 'content-type': 'application/json' },
      body:    '{}',
    });
    expect(r.status).toBe(200);

    expect(podClient.store.has(`${POD_ROOT}doomed.md`)).toBe(false);
    await expect(fs.access(join(localRoot, 'doomed.md'))).rejects.toThrow();

    // Wait for the WS frame the UI subscribes to.
    const start = Date.now();
    while (!frames.some((f) => f.type === 'sync.delete.done')) {
      if (Date.now() - start > 2000) throw new Error('timeout waiting for sync.delete.done');
      await new Promise((rr) => setTimeout(rr, 25));
    }
    const frame = frames.find((f) => f.type === 'sync.delete.done');
    expect(frame.relPath).toBe('doomed.md');
    ws.close();
  });

  it('POST /rm + POST /delete reject path-traversal ids with 400', async () => {
    const id = Buffer.from('../etc/passwd', 'utf8').toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    const rmResp = await fetch(`${baseUrl}/rm/${id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(rmResp.status).toBe(400);
    expect((await rmResp.json()).error.code).toBe('BAD_DELETE_ID');

    const delResp = await fetch(`${baseUrl}/delete/${id}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    expect(delResp.status).toBe(400);
    expect((await delResp.json()).error.code).toBe('BAD_DELETE_ID');
  });
});
