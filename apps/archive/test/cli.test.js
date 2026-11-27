// @reads-source: this test reads source as text, so rung 1 runs it (docs/conventions/verification-ladder.md).
/**
 * cli.test.js — spawn-as-subprocess tests for the `archive` CLI.
 *
 * Strategy mirrors Folio's cli.test.js:
 *   - Each test gets its own `ARCHIVE_CONFIG_DIR` (tmp dir).
 *   - The pod is the FsBackedMockPodClient persisted to a JSON file
 *     (FOLIO_MOCK_POD_FILE) — gated by `FOLIO_TEST_MOCK_POD=1`.
 *   - We spawn `node src/cli.js <cmd>` and assert on stdout/stderr/exit.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs }   from 'node:fs';
import { spawn }            from 'node:child_process';
import { tmpdir }           from 'node:os';
import { join, dirname }    from 'node:path';
import { fileURLToPath }    from 'node:url';

const HERE     = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(HERE, '..', 'src', 'cli.js');

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

let cfgDir, dataDir, podFile, dbPath;
beforeEach(async () => {
  cfgDir  = await fs.mkdtemp(join(tmpdir(), 'archive-cfg-'));
  dataDir = await fs.mkdtemp(join(tmpdir(), 'archive-data-'));
  podFile = join(await fs.mkdtemp(join(tmpdir(), 'archive-pod-')), 'pod.json');
  dbPath  = join(dataDir, 'archive.db');
});
afterEach(async () => {
  for (const p of [cfgDir, dataDir, dirname(podFile)]) {
    try { await fs.rm(p, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

const baseEnv = () => ({
  ARCHIVE_CONFIG_DIR:   cfgDir,
  FOLIO_TEST_MOCK_POD:  '1',
  FOLIO_MOCK_POD_FILE:  podFile,
});

const POD_ROOT = 'https://alice.example/';

/**
 * Seed the pod-persistence file with a set of resources.  Mirrors what the
 * Folio mock would produce after a `write()` flush.
 */
async function seedPod(uris) {
  const store = {};
  let etag = 0;
  for (const [uri, body, ct] of uris) {
    store[uri] = {
      content:      body,
      contentType:  ct ?? 'text/markdown',
      lastModified: new Date(2025, 0, 1).toUTCString(),
      etag:         `"e${++etag}"`,
      size:         Buffer.byteLength(body, 'utf8'),
    };
  }
  await fs.mkdir(dirname(podFile), { recursive: true });
  await fs.writeFile(podFile, JSON.stringify({
    store, tombstones: [], etagCounter: etag,
  }));
}

// ── --help / --version / unknown ───────────────────────────────────────────

describe('archive --help / --version / unknown', () => {
  it('--help exits 0 and lists all six commands', async () => {
    const r = await runCli({ args: ['--help'] });
    expect(r.code).toBe(0);
    for (const c of ['init', 'add-source', 'index', 'search', 'status', 'show']) {
      expect(r.stdout).toContain(c);
    }
  });

  it('--version prints the version string and exits 0', async () => {
    const r = await runCli({ args: ['--version'] });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/archive 0\.\d+\.\d+/);
  });

  it('no args exits 2', async () => {
    const r = await runCli({ args: [] });
    expect(r.code).toBe(2);
  });

  it('unknown command exits 2', async () => {
    const r = await runCli({ args: ['frobnicate'] });
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('unknown command');
  });
});

// ── init ────────────────────────────────────────────────────────────────────

describe('archive init', () => {
  it('creates config + db at the given path', async () => {
    const r = await runCli({ args: ['init', dbPath], env: baseEnv() });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Archive is set up.');
    const cfg = JSON.parse(await fs.readFile(join(cfgDir, 'config.json'), 'utf8'));
    expect(cfg.dbPath).toBe(dbPath);
    // db file exists.
    await fs.access(dbPath);
  });

  it('refuses to overwrite an existing config without --force', async () => {
    await runCli({ args: ['init', dbPath], env: baseEnv() });
    const r = await runCli({ args: ['init', dbPath], env: baseEnv() });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('a config already exists');
  });

  it('--force overwrites the existing config', async () => {
    await runCli({ args: ['init', dbPath], env: baseEnv() });
    const newPath = join(dataDir, 'other.db');
    const r = await runCli({ args: ['init', newPath, '--force'], env: baseEnv() });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Archive is set up.');
    const cfg = JSON.parse(await fs.readFile(join(cfgDir, 'config.json'), 'utf8'));
    expect(cfg.dbPath).toBe(newPath);
  });

  it('running init twice with --force is idempotent (schema migration is safe)', async () => {
    const r1 = await runCli({ args: ['init', dbPath], env: baseEnv() });
    expect(r1.code).toBe(0);
    const r2 = await runCli({ args: ['init', dbPath, '--force'], env: baseEnv() });
    expect(r2.code).toBe(0);
  });
});

// ── add-source ──────────────────────────────────────────────────────────────

describe('archive add-source', () => {
  it('adds a pod root with a derived name', async () => {
    await runCli({ args: ['init', dbPath], env: baseEnv() });
    const r = await runCli({
      args: ['add-source', POD_ROOT],
      env:  baseEnv(),
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('alice.example');
  });

  it('honours --name', async () => {
    await runCli({ args: ['init', dbPath], env: baseEnv() });
    const r = await runCli({
      args: ['add-source', POD_ROOT, '--name', 'alice'],
      env:  baseEnv(),
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('alice');
  });

  it('refuses duplicate pod roots', async () => {
    await runCli({ args: ['init', dbPath], env: baseEnv() });
    await runCli({ args: ['add-source', POD_ROOT], env: baseEnv() });
    const r = await runCli({ args: ['add-source', POD_ROOT], env: baseEnv() });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('already');
  });

  it('without args exits 2 with usage', async () => {
    await runCli({ args: ['init', dbPath], env: baseEnv() });
    const r = await runCli({ args: ['add-source'], env: baseEnv() });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/usage|--name/);
  });

  it('without an init exits 1 with a config error', async () => {
    const r = await runCli({ args: ['add-source', POD_ROOT], env: baseEnv() });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no config');
  });
});

// ── index ───────────────────────────────────────────────────────────────────

describe('archive index', () => {
  beforeEach(async () => {
    await runCli({ args: ['init', dbPath], env: baseEnv() });
    await runCli({ args: ['add-source', POD_ROOT, '--name', 'alice'], env: baseEnv() });
  });

  it('walks the pod and inserts resources on first run', async () => {
    await seedPod([
      [`${POD_ROOT}cake.md`,  'cocoa cake recipe'],
      [`${POD_ROOT}sub/bread.md`, 'sourdough bread recipe'],
    ]);
    const r = await runCli({ args: ['index'], env: baseEnv() });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/scanned:\s+2/);
    expect(r.stdout).toMatch(/inserted:\s+2/);
  });

  it('second run is a no-op (unchanged=N)', async () => {
    await seedPod([[`${POD_ROOT}n.md`, 'body']]);
    await runCli({ args: ['index'], env: baseEnv() });
    const r = await runCli({ args: ['index'], env: baseEnv() });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/unchanged:\s+1/);
    expect(r.stdout).toMatch(/inserted:\s+0/);
  });

  it('--force re-indexes everything', async () => {
    await seedPod([[`${POD_ROOT}n.md`, 'body']]);
    await runCli({ args: ['index'], env: baseEnv() });
    const r = await runCli({ args: ['index', '--force'], env: baseEnv() });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/updated:\s+1/);
  });

  it('--source filters to one source (by name)', async () => {
    // Add a second source to prove the filter scopes.
    await runCli({
      args: ['add-source', 'https://bob.example/', '--name', 'bob'],
      env:  baseEnv(),
    });
    await seedPod([[`${POD_ROOT}n.md`, 'body']]);
    const r = await runCli({ args: ['index', '--source', 'alice'], env: baseEnv() });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('source alice');
    expect(r.stdout).not.toContain('source bob');
  });

  it('--source <unknown> errors with exit 1', async () => {
    const r = await runCli({ args: ['index', '--source', 'nope'], env: baseEnv() });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no source');
  });
});

// ── search ──────────────────────────────────────────────────────────────────

describe('archive search', () => {
  beforeEach(async () => {
    await runCli({ args: ['init', dbPath], env: baseEnv() });
    await runCli({ args: ['add-source', POD_ROOT, '--name', 'alice'], env: baseEnv() });
    await seedPod([
      [`${POD_ROOT}cake.md`,  'cocoa cake recipe'],
      [`${POD_ROOT}bread.md`, 'sourdough bread recipe'],
      [`${POD_ROOT}tax.md`,   'tax notes 2024'],
    ]);
    await runCli({ args: ['index'], env: baseEnv() });
  });

  it('returns ranked results with snippets', async () => {
    const r = await runCli({ args: ['search', 'cake'], env: baseEnv() });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('cake.md');
    expect(r.stdout).toContain('[alice]');
    // Snippet markers '[' / ']' present.
    expect(r.stdout).toMatch(/\[cake\]/);
  });

  it('"no results" prints a friendly marker', async () => {
    const r = await runCli({ args: ['search', 'transmogrify'], env: baseEnv() });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('(no results)');
  });

  it('--limit caps result count', async () => {
    const r = await runCli({ args: ['search', 'recipe', '--limit', '1'], env: baseEnv() });
    expect(r.code).toBe(0);
    const lines = r.stdout.trim().split('\n').filter(Boolean);
    expect(lines.length).toBe(1);
  });

  it('without args exits 2 with usage', async () => {
    const r = await runCli({ args: ['search'], env: baseEnv() });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/usage/);
  });
});

// ── status ──────────────────────────────────────────────────────────────────

describe('archive status', () => {
  it('reports zero sources before add-source', async () => {
    await runCli({ args: ['init', dbPath], env: baseEnv() });
    const r = await runCli({ args: ['status'], env: baseEnv() });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/sources:\s+0/);
    expect(r.stdout).toMatch(/resources:\s+0/);
  });

  it('lists sources + per-source counts after indexing', async () => {
    await runCli({ args: ['init', dbPath], env: baseEnv() });
    await runCli({ args: ['add-source', POD_ROOT, '--name', 'alice'], env: baseEnv() });
    await seedPod([[`${POD_ROOT}n.md`, 'hi']]);
    await runCli({ args: ['index'], env: baseEnv() });
    const r = await runCli({ args: ['status'], env: baseEnv() });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('alice');
    expect(r.stdout).toMatch(/last indexed:\s+\d{4}-\d{2}-\d{2}T/);
    expect(r.stdout).toMatch(/resources:\s+1/);
  });

  it('exits 1 with a no-config message before init', async () => {
    const r = await runCli({ args: ['status'], env: baseEnv() });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no config');
  });
});

// ── show ────────────────────────────────────────────────────────────────────

describe('archive show', () => {
  beforeEach(async () => {
    await runCli({ args: ['init', dbPath], env: baseEnv() });
    await runCli({ args: ['add-source', POD_ROOT, '--name', 'alice'], env: baseEnv() });
    await seedPod([
      [`${POD_ROOT}cake.md`, 'cocoa cake recipe', 'text/markdown'],
      [`${POD_ROOT}photo.jpg`, '\xFF\xD8\xFF\xE0binary', 'image/jpeg'],
    ]);
    await runCli({ args: ['index'], env: baseEnv() });
  });

  it('prints metadata + body for a known text URI', async () => {
    const r = await runCli({ args: ['show', `${POD_ROOT}cake.md`], env: baseEnv() });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('cake.md');
    expect(r.stdout).toContain('cocoa cake recipe');
    expect(r.stdout).toContain('sha256:');
  });

  it('prints "not indexed" for binary resources', async () => {
    const r = await runCli({ args: ['show', `${POD_ROOT}photo.jpg`], env: baseEnv() });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('image/jpeg');
    expect(r.stdout).toContain('not indexed');
  });

  it('--metadata-only suppresses the body', async () => {
    const r = await runCli({
      args: ['show', `${POD_ROOT}cake.md`, '--metadata-only'],
      env:  baseEnv(),
    });
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain('cocoa cake recipe');
    expect(r.stdout).toContain('sha256:');
  });

  it('refuses unknown URIs (path-traversal guard)', async () => {
    const r = await runCli({ args: ['show', 'file:///etc/passwd'], env: baseEnv() });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no indexed resource');
  });

  it('without args exits 2 with usage', async () => {
    const r = await runCli({ args: ['show'], env: baseEnv() });
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/usage/);
  });
});
