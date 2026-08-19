/**
 * diagnostics.js — shared step engine for `folio doctor` (CLI) and the
 * web UI's Settings → Diagnostics panel (Folio v2.3).
 *
 * The 16 PASS/FAIL/WARN steps used to live inline in `cli/doctorCmd.js`.
 * This module lifts them out so:
 *
 *   - the CLI command is a thin pretty-printer (preserved verbatim — same
 *     stdout format, same exit codes, same JSON shape)
 *   - the server can call `runDiagnostics()` with a streaming reporter
 *     that broadcasts each step over WebSocket as it happens
 *
 * Public surface
 *
 *   runDiagnostics(reporter, deps)
 *     ↑   ↑
 *     │   └── { buildPodClient?, createSolidAuth?, configPath?, configDir?,
 *     │       loadConfig?, vaultFactory?, randomBytes?, scanLocal?,
 *     │       scanPod?, PathMap? }   — every external dep is injectable
 *     │
 *     └── { step({ id, status, label, detail?, error? }) }   — called once
 *         per step, in the order the user expects to see them; the same
 *         `record()` callback shape doctorCmd's CLI Report consumes.
 *
 *   STEP_IDS                — frozen array of every step id, in order
 *   labelFor(id)            — human label for a SKIPped/short-circuited id
 *   recommendFix(failedId)  — fix-string the CLI summary + UI surface use
 *
 * Probe URI: `<podRoot>.folio-doctor-probe-<random-8-hex>`, deleted in a
 * `try { … } finally { delete probe }` even when a mid-flow check throws.
 *
 * The 16-step sequence (preserved verbatim from the CLI):
 *   1. config exists                            (FAIL → exit 2)
 *   2. vault file exists
 *   3. vault contains a bootstrap mnemonic
 *   4. vault contains an OIDC refresh token     (mock-pod path: WARN, keeps going)
 *   5. local notes folder is readable
 *   6. marker file present
 *   7. sync state present
 *   8. sync state freshness                     (WARN if older than 7 days)
 *   9. OIDC session restored from vault         (mock-pod path: WARN, keeps going)
 *  10. pod root reachable (HEAD)
 *  11. pod root container exists (createContainer)
 *  12. test write to <podRoot>.folio-doctor-probe-<rand>
 *  13. test read of <podRoot>.folio-doctor-probe-<rand>
 *  14. test delete of <podRoot>.folio-doctor-probe-<rand>
 *  15. scanLocal returns the same files as fs.readdir
 *  16. scanPod returns the test write results (sanity)
 */
import { promises as defaultFs } from 'node:fs';
import { join }                  from 'node:path';
import { randomBytes as defaultRandomBytes } from 'node:crypto';

import { VaultNodeFs as DefaultVaultNodeFs } from '@onderling/vault';

import {
  configDir as defaultConfigDir,
  configPath as defaultConfigPath,
  loadConfig as defaultLoadConfig,
} from './cli/_config.js';
import { buildPodClient as defaultBuildPodClient } from './cli/_podFactory.js';
import {
  createSolidAuthNode as defaultCreateSolidAuthNode,
  OIDC_VAULT_KEYS,
} from '@onderling/oidc-session';

import { PathMap as DefaultPathMap } from './PathMap.js';
import { scanLocal as defaultScanLocal } from './scanLocal.js';
import { scanPod   as defaultScanPod   } from './scanPod.js';

/* ── Constants ──────────────────────────────────────────────────────────── */

/**
 * Step ids in the canonical order the user sees them stream over the wire.
 *
 * Note: probe-delete fires from the `finally` block AFTER probe-read +
 * scan-pod (which both run inside the same try), and scan-local runs
 * after the probe finally.  The display labels still call out probe-delete
 * as "step 14" of the documented 16-step list (the user sees it logged
 * relative to the probe URI it's cleaning up); STEP_IDS reflects the
 * actual streaming order so the UI can populate placeholder rows in the
 * order the events arrive.
 *
 * Frozen so callers (e.g. the UI rendering an empty step list before the
 * run begins) can rely on it.
 */
export const STEP_IDS = Object.freeze([
  'config',
  'vault',
  'vault-mnemonic',
  'vault-refresh',
  'local-folder',
  'marker',
  'sync-state',
  'sync-state-fresh',
  'oidc-restored',
  'pod-head',
  'pod-container',
  'probe-write',
  'probe-read',
  'scan-pod',
  'probe-delete',
  'scan-local',
]);

/** Total step count — exported for the UI's "step idx/total" label. */
export const STEP_TOTAL = STEP_IDS.length;

/* ── Public API ─────────────────────────────────────────────────────────── */

/**
 * Run the full 16-step doctor sequence.  Streams each step result through
 * `reporter.step({ id, status, label, detail?, error? })` in order.
 *
 * @param {{ step: (event: object) => void }} reporter
 * @param {object} [deps]   All deps are optional and default to the real
 *                           implementations.  Tests inject mocks.
 * @returns {Promise<{ abortReason: string|null, cfg: object|null, counts: object }>}
 */
export async function runDiagnostics(reporter, deps = {}) {
  const fs = deps.fs ?? defaultFs;
  const buildPodClient = deps.buildPodClient ?? defaultBuildPodClient;
  const createSolidAuth = deps.createSolidAuth ?? defaultCreateSolidAuthNode;
  const VaultNodeFs    = deps.VaultNodeFs    ?? DefaultVaultNodeFs;
  const configDir      = deps.configDir      ?? defaultConfigDir;
  const configPath     = deps.configPath     ?? defaultConfigPath;
  const loadConfig     = deps.loadConfig     ?? defaultLoadConfig;
  const randomBytes    = deps.randomBytes    ?? defaultRandomBytes;
  const PathMap        = deps.PathMap        ?? DefaultPathMap;
  const scanLocal      = deps.scanLocal      ?? defaultScanLocal;
  const scanPod        = deps.scanPod        ?? defaultScanPod;

  if (!reporter || typeof reporter.step !== 'function') {
    throw new Error('runDiagnostics: reporter.step(event) is required');
  }

  const counts = { PASS: 0, FAIL: 0, WARN: 0, SKIP: 0 };
  const seen = new Set();
  function emit(id, status, label, detail = null, error = null) {
    seen.add(id);
    counts[status]++;
    reporter.step({ id, status, label, detail, error });
  }
  function pass(id, label, detail) { emit(id, 'PASS', label, detail); }
  function fail(id, label, detail, err) { emit(id, 'FAIL', label, detail, err); }
  function warn(id, label, detail, err) { emit(id, 'WARN', label, detail, err); }
  function skip(id, label, detail) { emit(id, 'SKIP', label, detail); }
  function skipRemaining(ids) {
    for (const id of ids) {
      if (!seen.has(id)) skip(id, labelFor(id));
    }
  }

  // ── 1. Config ─────────────────────────────────────────────────────────
  const cfgPath = configPath();
  let cfg;
  try {
    cfg = await loadConfig();
  } catch (err) {
    fail('config', `config exists at ${cfgPath}`, null, err);
    skipRemaining(STEP_IDS);
    return { abortReason: 'NO_CONFIG', cfg: null, counts };
  }
  if (!cfg) {
    fail('config', `config exists at ${cfgPath}`, 'no config file at that path');
    skipRemaining(STEP_IDS);
    return { abortReason: 'NO_CONFIG', cfg: null, counts };
  }
  pass('config', `config exists at ${cfgPath}`);

  // ── 2. Vault file ─────────────────────────────────────────────────────
  const vaultPath = cfg.vaultPath ?? join(configDir(), 'vault.json');
  try {
    const text = await fs.readFile(vaultPath, 'utf8');
    JSON.parse(text); // sanity-parse; structure is checked in step 3.
    pass('vault', `vault exists at ${vaultPath}`);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      fail('vault', `vault exists at ${vaultPath}`,
        'no vault file — Folio cannot derive identity', err);
    } else {
      fail('vault', `vault exists at ${vaultPath}`,
        `vault unreadable: ${err.message}`, err);
    }
    skipRemaining([
      'vault-mnemonic', 'vault-refresh', 'local-folder', 'marker',
      'sync-state', 'sync-state-fresh', 'oidc-restored',
      'pod-head', 'pod-container', 'probe-write', 'probe-read', 'probe-delete',
      'scan-local', 'scan-pod',
    ]);
    return { abortReason: 'NO_VAULT', cfg, counts };
  }

  // ── 3. Bootstrap mnemonic ─────────────────────────────────────────────
  let vault;
  try {
    vault = new VaultNodeFs(vaultPath);
    const mnemonic = await vault.get('bootstrap-mnemonic');
    if (typeof mnemonic === 'string' && mnemonic.trim().split(/\s+/).length === 24) {
      pass('vault-mnemonic', 'vault contains a bootstrap mnemonic (24 words)');
    } else if (typeof mnemonic === 'string' && mnemonic.length > 0) {
      warn('vault-mnemonic', 'vault contains a bootstrap mnemonic',
        `expected 24 words, got ${mnemonic.trim().split(/\s+/).length}`);
    } else {
      fail('vault-mnemonic', 'vault contains a bootstrap mnemonic (24 words)',
        'no `bootstrap-mnemonic` entry in the vault');
    }
  } catch (err) {
    fail('vault-mnemonic', 'vault contains a bootstrap mnemonic (24 words)',
      `vault read failed: ${err.message}`, err);
  }

  // ── 4. OIDC refresh token (WARN under the mock-pod path) ──────────────
  const isMock = process.env.FOLIO_TEST_MOCK_POD === '1';
  let refreshTokenPresent = false;
  let issuer = null;
  try {
    const refresh = vault ? await vault.get(OIDC_VAULT_KEYS.REFRESH_TOKEN) : null;
    issuer        = vault ? await vault.get(OIDC_VAULT_KEYS.ISSUER) : null;
    refreshTokenPresent = typeof refresh === 'string' && refresh.length > 0;
    if (refreshTokenPresent) {
      pass('vault-refresh', 'vault contains an OIDC refresh token',
        issuer ? `issuer: ${issuer}` : null);
    } else if (isMock) {
      warn('vault-refresh', 'vault contains an OIDC refresh token',
        'no OIDC refresh token (mock-pod path: not required)');
    } else {
      fail('vault-refresh', 'vault contains an OIDC refresh token',
        'no OIDC refresh token — start `folio serve` and click Sign in');
    }
  } catch (err) {
    if (isMock) {
      warn('vault-refresh', 'vault contains an OIDC refresh token',
        `vault read failed (mock-pod path: continuing): ${err.message}`, err);
    } else {
      fail('vault-refresh', 'vault contains an OIDC refresh token',
        `vault read failed: ${err.message}`, err);
    }
  }

  // ── 5. Local notes folder ─────────────────────────────────────────────
  let localScanReady = false;
  try {
    const st = await fs.stat(cfg.localRoot);
    if (!st.isDirectory()) {
      fail('local-folder', `local notes folder is readable: ${cfg.localRoot}`,
        'path exists but is not a directory');
    } else {
      await fs.readdir(cfg.localRoot);
      const sizeInfo = await summarizeFolder(fs, cfg.localRoot);
      pass('local-folder', `local notes folder is readable: ${cfg.localRoot}`,
        `files: ${sizeInfo.fileCount} (${formatBytes(sizeInfo.totalBytes)})`);
      localScanReady = true;
    }
  } catch (err) {
    fail('local-folder', `local notes folder is readable: ${cfg.localRoot}`,
      err.message, err);
  }

  // ── 6. Marker file ────────────────────────────────────────────────────
  const markerPath = join(cfg.localRoot, '.onderling', '.folio-managed');
  try {
    await fs.access(markerPath);
    pass('marker', `marker file present at ${markerPath}`);
  } catch (err) {
    warn('marker', `marker file present at ${markerPath}`,
      'no `.folio-managed` marker — folder may not be a Folio root', err);
  }

  // ── 7. Sync state ─────────────────────────────────────────────────────
  const statePath = join(cfg.localRoot, '.onderling', 'notes-sync-state.json');
  let stateWrittenAt = null;
  let stateFileCount = 0;
  try {
    const text = await fs.readFile(statePath, 'utf8');
    const parsed = JSON.parse(text);
    stateFileCount = Object.keys(parsed?.files ?? {}).length;
    stateWrittenAt = parsed?.writtenAt ?? null;
    pass('sync-state', `sync state present (${stateFileCount} files tracked)`);
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      warn('sync-state', 'sync state present',
        'no sync state yet — run `folio sync` once to create it');
    } else {
      fail('sync-state', 'sync state present',
        `state file unreadable: ${err.message}`, err);
    }
  }

  // ── 8. Sync state freshness ──────────────────────────────────────────
  if (stateWrittenAt) {
    const ageMs   = Date.now() - stateWrittenAt;
    const ageDays = Math.floor(ageMs / (24 * 3600 * 1000));
    if (ageMs > 7 * 24 * 3600 * 1000) {
      warn('sync-state-fresh', `sync state's syncedAt is ${ageDays} days old`,
        'consider running `folio sync` to refresh');
    } else {
      pass('sync-state-fresh', 'sync state freshness',
        `last sync ${ageDays} day(s) ago`);
    }
  } else {
    skip('sync-state-fresh', 'sync state freshness');
  }

  // ── 9. OIDC session restore ──────────────────────────────────────────
  let oidc = null;
  if (isMock) {
    warn('oidc-restored', 'OIDC session restored from vault',
      'mock-pod path: skipping real OIDC restore');
  } else if (!refreshTokenPresent) {
    skip('oidc-restored', 'OIDC session restored from vault');
  } else {
    try {
      oidc = createSolidAuth({ vault, clientName: 'Folio' });
      const restored = await oidc.restoreFromVault({
        onWarning: () => { /* swallow; reflected via the boolean return */ },
      });
      if (restored) {
        pass('oidc-restored', 'OIDC session restored from vault',
          oidc.webid ? `webid: ${oidc.webid}` : null);
      } else {
        fail('oidc-restored', 'OIDC session restored from vault',
          'refresh failed — your refresh token may have expired; sign in again via http://127.0.0.1:8888');
        oidc = null;
      }
    } catch (err) {
      fail('oidc-restored', 'OIDC session restored from vault', err.message, err);
      oidc = null;
    }
  }

  // ── 10–14. Pod-side checks ───────────────────────────────────────────
  let podClient = null;
  try {
    podClient = await buildPodClient(cfg, { oidc });
  } catch (err) {
    fail('pod-head', `pod root reachable: ${cfg.podRoot}`, err.message, err);
    skipRemaining([
      'pod-container', 'probe-write', 'probe-read', 'probe-delete', 'scan-pod',
    ]);
    if (localScanReady) {
      await runScanLocalCheck({ pass, fail, scanLocal, PathMap }, cfg);
    } else {
      skip('scan-local', 'scanLocal returns the same files as fs.readdir');
    }
    return { abortReason: null, cfg, counts };
  }

  // Probe URI: leading-dot + random suffix to avoid clobbering user files.
  const probeName = `.folio-doctor-probe-${randomBytes(4).toString('hex')}`;
  const probeUri  = joinPodUri(cfg.podRoot, probeName);
  const probeBody = `folio-doctor probe at ${new Date().toISOString()}`;

  let probeWritten = false;
  try {
    // 10. HEAD-equivalent
    try {
      await podClient.list(cfg.podRoot, { recursive: false });
      pass('pod-head', `pod root reachable: ${cfg.podRoot}`,
        'list() returned successfully');
    } catch (err) {
      fail('pod-head', `pod root reachable: ${cfg.podRoot}`,
        diagnosePodErr(err), err);
      skipRemaining([
        'pod-container', 'probe-write', 'probe-read', 'probe-delete', 'scan-pod',
      ]);
      throw new ProbeAbort();
    }

    // 11. createContainer
    try {
      if (typeof podClient.createContainer === 'function') {
        await podClient.createContainer(cfg.podRoot);
      }
      pass('pod-container', 'pod root container exists (createContainer is idempotent)');
    } catch (err) {
      fail('pod-container', 'pod root container exists',
        'your pod server doesn\'t honour LDP createContainerAt', err);
      skipRemaining([
        'probe-write', 'probe-read', 'probe-delete', 'scan-pod',
      ]);
      throw new ProbeAbort();
    }

    // 12. Probe write
    try {
      await podClient.write(probeUri, probeBody, { contentType: 'text/plain' });
      probeWritten = true;
      pass('probe-write', `test write to ${probeUri}`);
    } catch (err) {
      fail('probe-write', `test write to ${probeUri}`, err.message, err);
      skipRemaining(['probe-read', 'probe-delete', 'scan-pod']);
      throw new ProbeAbort();
    }

    // 13. Probe read
    try {
      const r = await podClient.read(probeUri, { decode: 'string' });
      const got = typeof r?.content === 'string'
        ? r.content
        : new TextDecoder().decode(r?.content ?? new Uint8Array());
      if (got === probeBody) {
        pass('probe-read', `test read of ${probeUri} matches`);
      } else {
        fail('probe-read', `test read of ${probeUri}`,
          `content mismatch: expected ${probeBody.length} bytes`);
      }
    } catch (err) {
      fail('probe-read', `test read of ${probeUri}`, err.message, err);
    }

    // 16. scanPod sanity
    try {
      const pathMap = new PathMap({ localRoot: cfg.localRoot, podRoot: cfg.podRoot });
      const podEntries = await scanPod(podClient, cfg.podRoot, { pathMap });
      pass('scan-pod', 'scanPod returns results',
        `non-dotfile entries: ${podEntries.length}`);
    } catch (err) {
      fail('scan-pod', 'scanPod returns results', err.message, err);
    }
  } catch (err) {
    if (!(err instanceof ProbeAbort)) {
      fail('probe-unexpected', 'probe sequence raised unexpectedly',
        err.message, err);
    }
  } finally {
    // 14. Probe delete — bullet-proof cleanup.
    if (probeWritten) {
      try {
        await podClient.delete(probeUri, { force: true });
        pass('probe-delete', `test delete of ${probeUri}`);
      } catch (err) {
        warn('probe-delete', `test delete of ${probeUri}`,
          `cleanup failed (probe is harmless): ${err.message}`, err);
      }
    } else if (!seen.has('probe-delete')) {
      skip('probe-delete', 'test delete of probe');
    }
  }

  // ── 15. scanLocal vs fs.readdir ──────────────────────────────────────
  if (localScanReady) {
    await runScanLocalCheck({ pass, fail, scanLocal, PathMap }, cfg);
  } else {
    skip('scan-local', 'scanLocal returns the same files as fs.readdir');
  }

  return { abortReason: null, cfg, counts };
}

/* ── Helpers (exported) ─────────────────────────────────────────────────── */

/**
 * Map a step id to the human-friendly label used when the step is SKIPped
 * before its in-flow `pass()/fail()` had a chance to set one.  Mirrors the
 * cases the CLI's pretty-printer used.
 */
export function labelFor(id) {
  switch (id) {
    case 'config':            return 'config exists';
    case 'vault':             return 'vault exists';
    case 'vault-mnemonic':    return 'vault contains a bootstrap mnemonic';
    case 'vault-refresh':     return 'vault contains an OIDC refresh token';
    case 'local-folder':      return 'local notes folder is readable';
    case 'marker':            return 'marker file present';
    case 'sync-state':        return 'sync state present';
    case 'sync-state-fresh':  return 'sync state freshness';
    case 'oidc-restored':     return 'OIDC session restored from vault';
    case 'pod-head':          return 'pod root reachable';
    case 'pod-container':     return 'pod root container exists';
    case 'probe-write':       return 'test write to probe URI';
    case 'probe-read':        return 'test read of probe URI';
    case 'probe-delete':      return 'test delete of probe URI';
    case 'scan-local':        return 'scanLocal returns the same files as fs.readdir';
    case 'scan-pod':          return 'scanPod returns results';
    default:                  return id;
  }
}

/**
 * Given a report (the array of step events as recorded), produce the
 * `recommendedFix` string the CLI summary emits and the UI surfaces in
 * the Settings panel.
 *
 * @param {Array<{ id: string, status: string }>} steps
 * @returns {string|null}  null when nothing failed.
 */
export function recommendFix(steps) {
  const firstFail = steps.find((s) => s.status === 'FAIL');
  if (!firstFail) return null;
  switch (firstFail.id) {
    case 'config':
      return 'run `folio init <local-path>`.';
    case 'vault':
    case 'vault-mnemonic':
      return 'run `folio init <local-path>` to (re)create the vault.';
    case 'vault-refresh':
    case 'oidc-restored':
      return 'start `folio serve` and click Sign in (or refresh expired) at http://127.0.0.1:8888';
    case 'pod-head':
      return 'pod unreachable; if 401 sign in again, if 403 your WebID lacks write access.';
    case 'pod-container':
      return 'your pod server doesn\'t honour LDP createContainerAt; check pod compatibility.';
    case 'probe-write':
    case 'probe-read':
      return 'pod write/read probe failed; verify ACL grants for your WebID.';
    default:
      return `see [FAIL] ${firstFail.id} above.`;
  }
}

/* ── Internals ──────────────────────────────────────────────────────────── */

async function runScanLocalCheck({ pass, fail, scanLocal, PathMap }, cfg) {
  try {
    const pathMap = new PathMap({ localRoot: cfg.localRoot, podRoot: cfg.podRoot });
    const scanned = await scanLocal(cfg.localRoot, { pathMap });
    const scannedRel = new Set(scanned.map((f) => f.relPath));

    const direct = new Set();
    await collectVisibleFiles(defaultFs, cfg.localRoot, '', pathMap, direct);

    const missing = [...direct].filter((p) => !scannedRel.has(p));
    const extra   = [...scannedRel].filter((p) => !direct.has(p));
    if (missing.length === 0 && extra.length === 0) {
      pass('scan-local', 'scanLocal returns the same files as fs.readdir',
        `${scanned.length} file(s) in agreement`);
    } else {
      fail('scan-local', 'scanLocal returns the same files as fs.readdir',
        `missing: ${missing.length}, extra: ${extra.length}`);
    }
  } catch (err) {
    fail('scan-local', 'scanLocal returns the same files as fs.readdir',
      err.message, err);
  }
}

async function collectVisibleFiles(fs, absDir, relDir, pathMap, out) {
  let dirents;
  try {
    dirents = await fs.readdir(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of dirents) {
    const childRel = relDir === '' ? ent.name : `${relDir}/${ent.name}`;
    if (ent.isDirectory()) {
      if (pathMap.shouldSkipDir(childRel)) continue;
      await collectVisibleFiles(fs, join(absDir, ent.name), childRel, pathMap, out);
      continue;
    }
    if (!ent.isFile()) continue;
    if (!pathMap.shouldSync(childRel)) continue;
    out.add(childRel);
  }
}

async function summarizeFolder(fs, absDir) {
  let fileCount = 0;
  let totalBytes = 0;
  await walk(absDir);
  return { fileCount, totalBytes };

  async function walk(dir) {
    let dirents;
    try { dirents = await fs.readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const ent of dirents) {
      if (ent.name.startsWith('.')) continue;
      const child = join(dir, ent.name);
      if (ent.isDirectory()) await walk(child);
      else if (ent.isFile()) {
        try {
          const st = await fs.stat(child);
          fileCount++;
          totalBytes += st.size;
        } catch { /* ignore */ }
      }
    }
  }
}

class ProbeAbort extends Error {
  constructor() { super('probe-abort'); this.name = 'ProbeAbort'; }
}

function joinPodUri(podRoot, name) {
  const root = String(podRoot).endsWith('/') ? podRoot : `${podRoot}/`;
  return `${root}${name}`;
}

function diagnosePodErr(err) {
  const msg  = err?.message ?? String(err);
  const code = err?.code;
  const status = err?.status ?? err?.httpStatus;
  if (status === 401 || /401/.test(msg)) {
    return 'HTTP 401 — your refresh token may have expired; sign in again via http://127.0.0.1:8888';
  }
  if (status === 403 || /403/.test(msg)) {
    return 'HTTP 403 — your WebID may not have write access to that pod root';
  }
  if (status === 404 || code === 'NOT_FOUND') {
    return 'HTTP 404 — pod root container does not exist';
  }
  return msg;
}

function formatBytes(n) {
  if (!Number.isFinite(n)) return '? bytes';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}
