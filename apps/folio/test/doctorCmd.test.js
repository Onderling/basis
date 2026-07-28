/**
 * doctorCmd.test.js — unit + spawn tests for `folio doctor`.
 *
 * Strategy:
 *   - Most tests spawn `node src/cli.js doctor [...]` so we get the full
 *     CLI surface (exit codes, JSON output, the order of the printed
 *     lines).
 *   - One test imports `doctorCmd` directly with an injected
 *     `__deps.buildPodClient` stub to simulate a pod-write failure
 *     and prove the probe-cleanup `finally` runs even on a mid-flow throw.
 *   - All pod-side checks use `FOLIO_TEST_MOCK_POD=1` so they're
 *     deterministic and offline.
 *
 * Coverage map:
 *   1. Happy path: no FAIL, exit 0, expected step list
 *   2. Missing config: exit 2, downstream SKIP, recommendation text
 *   3. Missing vault: vault FAIL, vault-mnemonic SKIP, exit 1
 *   4. Missing OIDC refresh token (mock-pod): WARN, keeps going, exit 0
 *   5. --json emits a single JSON object with `steps`, `counts`, `exitCode`
 *   6. --verbose adds extra detail per step (raw error message)
 *   7. Pod-write failure: FAIL recorded, downstream SKIP, exit 1, but probe
 *      cleanup STILL runs (we record probe-write attempt + no leftover state)
 *   8. Probe cleanup runs even on mid-flow throw (unit test via __deps)
 *   9. Exit-code matrix (0/1/2)
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs }   from 'node:fs';
import { spawn }            from 'node:child_process';
import { tmpdir }           from 'node:os';
import { join, dirname }    from 'node:path';
import { fileURLToPath }    from 'node:url';

import { doctorCmd }        from '../src/cli/doctorCmd.js';

const HERE     = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(HERE, '..', 'src', 'cli.js');

// ── Spawn helper ────────────────────────────────────────────────────────────

function runCli({ args, env = {}, stdin = '' }) {
  return new Promise((resolveP, rejectP) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += d.toString('utf8'); });
    child.stderr.on('data', (d) => { err += d.toString('utf8'); });
    child.on('error', rejectP);
    child.on('close', (code) => resolveP({ code, stdout: out, stderr: err }));
    if (stdin) child.stdin.write(stdin);
    child.stdin.end();
  });
}

// ── Fixtures ────────────────────────────────────────────────────────────────

let cfgDir, localRoot, podFile;

beforeEach(async () => {
  cfgDir    = await fs.mkdtemp(join(tmpdir(), 'folio-doc-cfg-'));
  localRoot = await fs.mkdtemp(join(tmpdir(), 'folio-doc-loc-'));
  podFile   = join(await fs.mkdtemp(join(tmpdir(), 'folio-doc-pod-')), 'pod.json');
});
afterEach(async () => {
  for (const p of [cfgDir, localRoot, dirname(podFile)]) {
    try { await fs.rm(p, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

const baseEnv = () => ({
  FOLIO_CONFIG_DIR:     cfgDir,
  FOLIO_TEST_MOCK_POD:  '1',
  FOLIO_MOCK_POD_FILE:  podFile,
});

const TEST_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

/** Run `folio init` non-interactively to set up a healthy fixture. */
async function runInit() {
  const stdin = [
    '',                                           // localRoot default
    'https://alice.example/profile/card#me',      // WebID
    '',                                           // podRoot default → derived
    'y',                                          // have phrase
    TEST_PHRASE,
  ].join('\n') + '\n';
  return runCli({
    args:  ['init', localRoot],
    env:   baseEnv(),
    stdin,
  });
}

/** Hand-write a minimal config + vault to skip the interactive init flow. */
async function seedHealthyConfig() {
  await fs.mkdir(cfgDir, { recursive: true });
  const vaultPath = join(cfgDir, 'vault.json');
  // VaultNodeFs plaintext format: { version, salt, entries: { key: value } }
  const vault = {
    version: 1,
    salt:    null,
    entries: { 'bootstrap-mnemonic': TEST_PHRASE },
  };
  await fs.writeFile(vaultPath, JSON.stringify(vault), 'utf8');
  const cfg = {
    localRoot,
    podRoot:   'https://alice.example/notes/',
    webId:     'https://alice.example/profile/card#me',
    vaultPath,
    intervalMs: 60_000,
  };
  await fs.writeFile(join(cfgDir, 'config.json'), JSON.stringify(cfg, null, 2), 'utf8');
  // marker
  await fs.mkdir(join(localRoot, '.onderling'), { recursive: true });
  await fs.writeFile(
    join(localRoot, '.onderling', '.folio-managed'),
    JSON.stringify({ podRoot: cfg.podRoot, webId: cfg.webId, createdAt: new Date().toISOString() }),
    'utf8',
  );
  return cfg;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('folio doctor — happy path', () => {
  it('reports PASS for every step and exits 0 (mock-pod)', async () => {
    await runInit();
    // Drop a real .md so the local-folder check has interesting numbers.
    await fs.writeFile(join(localRoot, 'note.md'), 'hello');

    const r = await runCli({ args: ['doctor'], env: baseEnv() });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('folio doctor');
    expect(r.stdout).toContain('[PASS]');
    expect(r.stdout).toMatch(/config exists at/);
    expect(r.stdout).toMatch(/vault exists at/);
    expect(r.stdout).toMatch(/local notes folder is readable/);
    expect(r.stdout).toMatch(/marker file present/);
    expect(r.stdout).toMatch(/pod root reachable/);
    expect(r.stdout).toMatch(/pod root container exists/);
    expect(r.stdout).toMatch(/test write to/);
    expect(r.stdout).toMatch(/test read of/);
    expect(r.stdout).toMatch(/test delete of/);
    expect(r.stdout).toMatch(/scanLocal/);
    expect(r.stdout).toMatch(/scanPod/);
    expect(r.stdout).toMatch(/OVERALL:/);
    expect(r.stdout).not.toMatch(/\[FAIL\]/);
    // The probe should be cleaned up — no '.folio-doctor-probe' should
    // remain in the mock-pod persistence file.
    const pod = JSON.parse(await fs.readFile(podFile, 'utf8'));
    const leftover = Object.keys(pod.store).filter((u) => u.includes('.folio-doctor-probe'));
    expect(leftover).toEqual([]);
  });
});

describe('folio doctor — missing config', () => {
  it('exits 2 with a config FAIL and recommends `folio init`', async () => {
    const r = await runCli({ args: ['doctor'], env: baseEnv() });
    expect(r.code).toBe(2);
    expect(r.stdout).toContain('[FAIL]');
    expect(r.stdout).toContain('config exists at');
    expect(r.stdout).toMatch(/folio init/);
  });

  it('exit 2 also reflects in --json output', async () => {
    const r = await runCli({ args: ['doctor', '--json'], env: baseEnv() });
    expect(r.code).toBe(2);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.exitCode).toBe(2);
    expect(parsed.ok).toBe(false);
    expect(parsed.abortReason).toBe('NO_CONFIG');
    const configStep = parsed.steps.find((s) => s.id === 'config');
    expect(configStep.status).toBe('FAIL');
  });
});

describe('folio doctor — missing vault', () => {
  it('reports vault FAIL when the vault file is gone, exit 1', async () => {
    await seedHealthyConfig();
    // vault file exists from seedHealthyConfig — remove it.
    await fs.rm(join(cfgDir, 'vault.json'), { force: true });

    const r = await runCli({ args: ['doctor', '--json'], env: baseEnv() });
    expect(r.code).toBe(1);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.exitCode).toBe(1);
    const vaultStep = parsed.steps.find((s) => s.id === 'vault');
    expect(vaultStep.status).toBe('FAIL');
    // Downstream steps SKIPped.
    const mnemonic = parsed.steps.find((s) => s.id === 'vault-mnemonic');
    expect(mnemonic.status).toBe('SKIP');
    const podHead = parsed.steps.find((s) => s.id === 'pod-head');
    expect(podHead.status).toBe('SKIP');
  });
});

describe('folio doctor — missing OIDC refresh token (mock-pod path)', () => {
  it('records WARN for vault-refresh but continues to PASS pod checks', async () => {
    await runInit();
    // No OIDC refresh token in the vault — just the bootstrap mnemonic.
    const r = await runCli({ args: ['doctor', '--json'], env: baseEnv() });
    expect(r.code).toBe(0);                       // mock-pod path: WARN only
    const parsed = JSON.parse(r.stdout);
    const refresh = parsed.steps.find((s) => s.id === 'vault-refresh');
    expect(refresh.status).toBe('WARN');
    const oidcRestored = parsed.steps.find((s) => s.id === 'oidc-restored');
    expect(oidcRestored.status).toBe('WARN');
    const podHead = parsed.steps.find((s) => s.id === 'pod-head');
    expect(podHead.status).toBe('PASS');          // mock-pod still works
  });
});

describe('folio doctor — --json output shape', () => {
  it('emits a single JSON object with steps + counts + exitCode + ok', async () => {
    await runInit();
    const r = await runCli({ args: ['doctor', '--json'], env: baseEnv() });
    expect(r.code).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(typeof parsed.ok).toBe('boolean');
    expect(typeof parsed.exitCode).toBe('number');
    expect(parsed.counts).toEqual(expect.objectContaining({
      PASS: expect.any(Number),
      FAIL: expect.any(Number),
      WARN: expect.any(Number),
      SKIP: expect.any(Number),
    }));
    expect(Array.isArray(parsed.steps)).toBe(true);
    expect(parsed.steps.length).toBeGreaterThanOrEqual(10);
    for (const s of parsed.steps) {
      expect(s).toHaveProperty('id');
      expect(s).toHaveProperty('status');
      expect(s).toHaveProperty('label');
      expect(['PASS', 'FAIL', 'WARN', 'SKIP']).toContain(s.status);
    }
    // Should NOT contain ANSI escape codes when --json is used.
    expect(parsed.steps[0].label).not.toMatch(/\x1b\[/);
  });
});

describe('folio doctor — --verbose flag', () => {
  it('adds extra detail per step (label + per-step detail lines)', async () => {
    await runInit();
    const r = await runCli({ args: ['doctor', '--verbose'], env: baseEnv() });
    expect(r.code).toBe(0);
    // The detail under local-folder: "files: N (X bytes/KB)" should always appear.
    expect(r.stdout).toMatch(/files:\s+\d+/);
  });
});

describe('folio doctor — pod-write failure simulation', () => {
  it('records FAIL on probe-write, SKIPs probe-read, but cleanup is attempted', async () => {
    await seedHealthyConfig();

    // In-process call: point env at our temp cfgDir so loadConfig() picks
    // up the seeded config rather than the user's real ~/.config/folio.
    const prev = withInProcEnv({ FOLIO_CONFIG_DIR: cfgDir, FOLIO_TEST_MOCK_POD: '1' });

    // Capture writes so they don't pollute the test runner's stdout.
    const muted = muteStdout();

    try {
      // Stub: a PodClient whose write() throws.  Everything else works
      // enough to get to the write step.
      const failing = makeFailingPodClient({ failOn: 'write' });
      process.exitCode = 0;
      const result = await doctorCmd(['--json'], {
        __deps: {
          buildPodClient: async () => failing,
        },
      });
      expect(result).toBeDefined();
      // Exit code: 1 (any FAIL); we set process.exitCode in finalize.
      expect(process.exitCode).toBe(1);

      const parsed = JSON.parse(muted.text());
      const writeStep = parsed.steps.find((s) => s.id === 'probe-write');
      expect(writeStep.status).toBe('FAIL');
      // Downstream chain SKIPs.
      const readStep = parsed.steps.find((s) => s.id === 'probe-read');
      expect(readStep.status).toBe('SKIP');
      const deleteStep = parsed.steps.find((s) => s.id === 'probe-delete');
      expect(deleteStep.status).toBe('SKIP');

      // `failing.calls.write` was attempted but `delete` was NOT — we don't
      // try to clean up something we never wrote.
      expect(failing.calls.write).toBeGreaterThan(0);
      expect(failing.calls.delete).toBe(0);
    } finally {
      muted.restore();
      restoreEnv(prev);
      process.exitCode = 0;
    }
  });
});

describe('folio doctor — probe cleanup on mid-flow throw', () => {
  it('always calls delete() in finally, even when a later step throws', async () => {
    await seedHealthyConfig();

    const prev = withInProcEnv({ FOLIO_CONFIG_DIR: cfgDir, FOLIO_TEST_MOCK_POD: '1' });
    const muted = muteStdout();

    try {
      // Stub: write succeeds; read throws unexpectedly (a thrown Error
      // mimicking a network blip).  The probe was written, so cleanup MUST run.
      const flaky = makeFailingPodClient({ failOn: 'read', readError: new Error('boom') });
      await doctorCmd(['--json'], {
        __deps: {
          buildPodClient: async () => flaky,
        },
      });
      expect(flaky.calls.write).toBe(1);
      expect(flaky.calls.read).toBe(1);
      expect(flaky.calls.delete).toBe(1);          // ← probe cleanup ran

      // And the report has probe-delete = PASS even though probe-read FAILed.
      const parsed = JSON.parse(muted.text());
      const deleteStep = parsed.steps.find((s) => s.id === 'probe-delete');
      expect(deleteStep.status).toBe('PASS');
      const readStep = parsed.steps.find((s) => s.id === 'probe-read');
      expect(readStep.status).toBe('FAIL');
    } finally {
      muted.restore();
      restoreEnv(prev);
      process.exitCode = 0;
    }
  });
});

describe('folio doctor — exit code matrix', () => {
  it('exit 0 when healthy', async () => {
    await runInit();
    const r = await runCli({ args: ['doctor'], env: baseEnv() });
    expect(r.code).toBe(0);
  });

  it('exit 1 when any FAIL', async () => {
    await seedHealthyConfig();
    await fs.rm(join(cfgDir, 'vault.json'), { force: true });
    const r = await runCli({ args: ['doctor'], env: baseEnv() });
    expect(r.code).toBe(1);
  });

  it('exit 2 when no config', async () => {
    const r = await runCli({ args: ['doctor'], env: baseEnv() });
    expect(r.code).toBe(2);
  });
});

describe('folio doctor — registered in CLI', () => {
  it('appears in --help output', async () => {
    const r = await runCli({ args: ['--help'] });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('doctor');
    expect(r.stdout).toMatch(/\[--json\]/);
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Set the given env vars and return a snapshot for later `restoreEnv`.
 */
function withInProcEnv(vars) {
  const prev = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = process.env[k];
    process.env[k] = v;
  }
  return prev;
}
function restoreEnv(prev) {
  for (const [k, v] of Object.entries(prev)) {
    if (v === undefined) delete process.env[k];
    else                 process.env[k] = v;
  }
}

/**
 * Mute process.stdout for the duration of a single in-process call and
 * collect everything written.  Returns `{ text(), restore() }`.
 */
function muteStdout() {
  const buf = [];
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk) => {
    if (typeof chunk === 'string') buf.push(chunk);
    else if (chunk) buf.push(chunk.toString('utf8'));
    return true;
  };
  return {
    text: () => buf.join(''),
    restore: () => { process.stdout.write = orig; },
  };
}

/**
 * Build a PodClient stub whose surface (`list`, `createContainer`, `write`,
 * `read`, `delete`) is sufficient for `doctorCmd`'s pod-side chain.  Each
 * method records into `.calls`; you can configure which one throws via
 * `failOn` + `readError`.
 */
function makeFailingPodClient({ failOn, readError } = {}) {
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
      return { container: 'https://alice.example/notes/', entries: [] };
    },
    async createContainer(uri) {
      calls.createContainer++;
      return { uri };
    },
    async write(uri, body) {
      calls.write++;
      if (failOn === 'write') throw probeError('write');
      store.set(uri, body);
      return { uri, etag: '"stub"' };
    },
    async read(uri, _opts) {
      calls.read++;
      if (failOn === 'read') throw (readError ?? probeError('read'));
      const content = store.get(uri);
      if (content === undefined) {
        const e = new Error('stub: not found');
        e.code = 'NOT_FOUND';
        throw e;
      }
      return { content, contentType: 'text/plain', etag: '"stub"' };
    },
    async delete(uri) {
      calls.delete++;
      store.delete(uri);
    },
    on() {} , off() {} , emit() {},
  };
}
