/**
 * diagnostics.test.js — pure-engine tests for the lifted step engine
 * (Folio v2.3).
 *
 * The CLI's existing `doctorCmd.test.js` already covers the spawned
 * pretty-printer + exit codes.  This file exercises `runDiagnostics()`
 * directly through a streaming reporter so we can:
 *
 *   1. Prove every one of the 16 step ids is emitted (in order, exactly
 *      once).
 *   2. Confirm the abortReason short-circuits SKIP downstream steps
 *      consistently.
 *   3. Exercise the probe-cleanup `finally` even on a mid-flow throw.
 *   4. Assert the reporter contract (one event per step; status one of
 *      PASS/FAIL/WARN/SKIP; label is always a string).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir }         from 'node:os';
import { join, dirname }  from 'node:path';

import {
  runDiagnostics,
  STEP_IDS,
  STEP_TOTAL,
  labelFor,
  recommendFix,
} from '../src/diagnostics.js';

// ── Fixtures ────────────────────────────────────────────────────────────────

const TEST_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

let cfgDir, localRoot, podFile, prevEnv;

beforeEach(async () => {
  cfgDir    = await fs.mkdtemp(join(tmpdir(), 'folio-diag-cfg-'));
  localRoot = await fs.mkdtemp(join(tmpdir(), 'folio-diag-loc-'));
  podFile   = join(await fs.mkdtemp(join(tmpdir(), 'folio-diag-pod-')), 'pod.json');
  prevEnv = {
    FOLIO_CONFIG_DIR:    process.env.FOLIO_CONFIG_DIR,
    FOLIO_TEST_MOCK_POD: process.env.FOLIO_TEST_MOCK_POD,
    FOLIO_MOCK_POD_FILE: process.env.FOLIO_MOCK_POD_FILE,
  };
  process.env.FOLIO_CONFIG_DIR    = cfgDir;
  process.env.FOLIO_TEST_MOCK_POD = '1';
  process.env.FOLIO_MOCK_POD_FILE = podFile;
});

afterEach(async () => {
  for (const p of [cfgDir, localRoot, dirname(podFile)]) {
    try { await fs.rm(p, { recursive: true, force: true }); } catch { /* ignore */ }
  }
  for (const [k, v] of Object.entries(prevEnv)) {
    if (v === undefined) delete process.env[k];
    else                 process.env[k] = v;
  }
});

/** Hand-write a healthy config + vault. */
async function seedHealthyConfig() {
  await fs.mkdir(cfgDir, { recursive: true });
  const vaultPath = join(cfgDir, 'vault.json');
  await fs.writeFile(vaultPath, JSON.stringify({
    version: 1, salt: null,
    entries: { 'bootstrap-mnemonic': TEST_PHRASE },
  }), 'utf8');
  const cfg = {
    localRoot,
    podRoot:   'https://alice.example/notes/',
    webId:     'https://alice.example/profile/card#me',
    vaultPath,
    intervalMs: 60_000,
  };
  await fs.writeFile(join(cfgDir, 'config.json'), JSON.stringify(cfg, null, 2), 'utf8');
  await fs.mkdir(join(localRoot, '.onderling'), { recursive: true });
  await fs.writeFile(
    join(localRoot, '.onderling', '.folio-managed'),
    JSON.stringify({ podRoot: cfg.podRoot, webId: cfg.webId }),
    'utf8',
  );
  return cfg;
}

function makePodClientStub({ failOn = null, readError = null } = {}) {
  const calls = { list: 0, createContainer: 0, write: 0, read: 0, delete: 0 };
  const store = new Map();
  const probeError = (where) => {
    const e = new Error(`stub: ${where} failed`);
    e.code = 'STUB_FAIL';
    return e;
  };
  return {
    podRoot: 'https://alice.example/notes/',
    calls,
    async list(_uri) {
      calls.list++;
      if (failOn === 'list') throw probeError('list');
      return { container: 'https://alice.example/notes/', entries: [] };
    },
    async createContainer(uri) {
      calls.createContainer++;
      if (failOn === 'createContainer') throw probeError('createContainer');
      return { uri };
    },
    async write(uri, body) {
      calls.write++;
      if (failOn === 'write') throw probeError('write');
      store.set(uri, body);
      return { uri, etag: '"stub"' };
    },
    async read(uri) {
      calls.read++;
      if (failOn === 'read') throw (readError ?? probeError('read'));
      const content = store.get(uri);
      if (content === undefined) {
        const e = new Error('stub: not found'); e.code = 'NOT_FOUND'; throw e;
      }
      return { content, contentType: 'text/plain', etag: '"stub"' };
    },
    async delete(uri) {
      calls.delete++;
      store.delete(uri);
    },
  };
}

function captureReporter() {
  const events = [];
  return {
    events,
    step(ev) { events.push(ev); },
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('STEP_IDS / labelFor / STEP_TOTAL', () => {
  it('exposes 16 step ids in order, with a label for each', () => {
    expect(STEP_IDS.length).toBe(16);
    expect(STEP_TOTAL).toBe(16);
    for (const id of STEP_IDS) {
      expect(typeof labelFor(id)).toBe('string');
      expect(labelFor(id).length).toBeGreaterThan(0);
    }
  });

  it('STEP_IDS is frozen so accidental mutation cannot reorder', () => {
    expect(Object.isFrozen(STEP_IDS)).toBe(true);
  });
});

describe('runDiagnostics — happy path (mock-pod)', () => {
  it('emits exactly 16 events with PASS/WARN only and FAIL=0', async () => {
    await seedHealthyConfig();
    await fs.writeFile(join(localRoot, 'note.md'), 'hello');

    const reporter = captureReporter();
    const result = await runDiagnostics(reporter);

    expect(result.abortReason).toBeNull();
    expect(result.cfg).toBeDefined();
    expect(result.counts.FAIL).toBe(0);

    // Every step id exactly once, in the canonical order.
    const ids = reporter.events.map((e) => e.id);
    expect(ids).toEqual([...STEP_IDS]);

    // Every event carries a string label.
    for (const ev of reporter.events) {
      expect(typeof ev.label).toBe('string');
      expect(ev.label.length).toBeGreaterThan(0);
      expect(['PASS', 'FAIL', 'WARN', 'SKIP']).toContain(ev.status);
    }

    // No probe leftover in the mock pod store.
    const pod = JSON.parse(await fs.readFile(podFile, 'utf8'));
    const leftovers = Object.keys(pod.store).filter((u) => u.includes('.folio-doctor-probe'));
    expect(leftovers).toEqual([]);
  });
});

describe('runDiagnostics — missing config short-circuits', () => {
  it('FAILs config + SKIPs every other step, sets abortReason', async () => {
    const reporter = captureReporter();
    const result = await runDiagnostics(reporter);

    expect(result.abortReason).toBe('NO_CONFIG');
    const configEv = reporter.events.find((e) => e.id === 'config');
    expect(configEv.status).toBe('FAIL');

    // Every downstream id must be SKIPped exactly once.
    for (const id of STEP_IDS.filter((x) => x !== 'config')) {
      const ev = reporter.events.find((e) => e.id === id);
      expect(ev).toBeDefined();
      expect(ev.status).toBe('SKIP');
    }
    // And no event id appears more than once.
    const ids = reporter.events.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('runDiagnostics — missing vault short-circuits', () => {
  it('FAILs vault + SKIPs subsequent vault/pod/scan steps', async () => {
    await seedHealthyConfig();
    await fs.rm(join(cfgDir, 'vault.json'), { force: true });

    const reporter = captureReporter();
    const result = await runDiagnostics(reporter);

    expect(result.abortReason).toBe('NO_VAULT');
    expect(reporter.events.find((e) => e.id === 'vault').status).toBe('FAIL');
    for (const id of [
      'vault-mnemonic', 'vault-refresh', 'pod-head', 'probe-write',
      'probe-read', 'probe-delete', 'scan-local', 'scan-pod',
    ]) {
      const ev = reporter.events.find((e) => e.id === id);
      expect(ev.status).toBe('SKIP');
    }
  });
});

describe('runDiagnostics — probe-write failure', () => {
  it('FAILs probe-write, SKIPs probe-read/delete/scan-pod, never calls delete', async () => {
    await seedHealthyConfig();
    const stub = makePodClientStub({ failOn: 'write' });

    const reporter = captureReporter();
    await runDiagnostics(reporter, { buildPodClient: async () => stub });

    expect(reporter.events.find((e) => e.id === 'probe-write').status).toBe('FAIL');
    expect(reporter.events.find((e) => e.id === 'probe-read').status).toBe('SKIP');
    expect(reporter.events.find((e) => e.id === 'probe-delete').status).toBe('SKIP');
    expect(reporter.events.find((e) => e.id === 'scan-pod').status).toBe('SKIP');

    expect(stub.calls.write).toBeGreaterThan(0);
    expect(stub.calls.delete).toBe(0);
  });
});

describe('runDiagnostics — probe cleanup on mid-flow throw', () => {
  it('still runs delete() in finally when read() throws', async () => {
    await seedHealthyConfig();
    const stub = makePodClientStub({
      failOn: 'read',
      readError: new Error('boom'),
    });

    const reporter = captureReporter();
    await runDiagnostics(reporter, { buildPodClient: async () => stub });

    expect(stub.calls.write).toBe(1);
    expect(stub.calls.read).toBe(1);
    expect(stub.calls.delete).toBe(1);

    expect(reporter.events.find((e) => e.id === 'probe-read').status).toBe('FAIL');
    expect(reporter.events.find((e) => e.id === 'probe-delete').status).toBe('PASS');
  });
});

describe('runDiagnostics — pod-head failure (no probe written)', () => {
  it('FAILs pod-head + SKIPs every downstream pod step; scan-local still runs', async () => {
    await seedHealthyConfig();
    const stub = makePodClientStub({ failOn: 'list' });

    const reporter = captureReporter();
    await runDiagnostics(reporter, { buildPodClient: async () => stub });

    expect(reporter.events.find((e) => e.id === 'pod-head').status).toBe('FAIL');
    for (const id of ['pod-container', 'probe-write', 'probe-read', 'probe-delete', 'scan-pod']) {
      expect(reporter.events.find((e) => e.id === id).status).toBe('SKIP');
    }
    // scan-local is independent — it should still run (PASS) since the local
    // folder is healthy.
    expect(reporter.events.find((e) => e.id === 'scan-local').status).toBe('PASS');
    // Probe never got written → delete never called.
    expect(stub.calls.delete).toBe(0);
  });
});

describe('runDiagnostics — reporter contract', () => {
  it('throws if reporter.step is not a function', async () => {
    await expect(runDiagnostics({}, {})).rejects.toThrow(/reporter\.step/);
    await expect(runDiagnostics(null, {})).rejects.toThrow(/reporter\.step/);
  });

  it('every event carries id + status + label', async () => {
    await seedHealthyConfig();
    const reporter = captureReporter();
    await runDiagnostics(reporter);
    for (const ev of reporter.events) {
      expect(typeof ev.id).toBe('string');
      expect(typeof ev.label).toBe('string');
      expect(['PASS', 'FAIL', 'WARN', 'SKIP']).toContain(ev.status);
    }
  });
});

describe('recommendFix', () => {
  it('returns null when nothing failed', () => {
    expect(recommendFix([
      { id: 'config', status: 'PASS' },
      { id: 'vault',  status: 'PASS' },
    ])).toBeNull();
  });

  it('points at `folio init` when config FAILs', () => {
    expect(recommendFix([{ id: 'config', status: 'FAIL' }]))
      .toMatch(/folio init/);
  });

  it('mentions sign-in for vault-refresh / oidc-restored', () => {
    expect(recommendFix([{ id: 'vault-refresh', status: 'FAIL' }]))
      .toMatch(/Sign in/);
    expect(recommendFix([{ id: 'oidc-restored', status: 'FAIL' }]))
      .toMatch(/Sign in/);
  });

  it('points at LDP for pod-container failures', () => {
    expect(recommendFix([{ id: 'pod-container', status: 'FAIL' }]))
      .toMatch(/LDP/);
  });
});
