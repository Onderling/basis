/**
 * cli.test.js — spawn-as-subprocess tests for the `folio` CLI.
 *
 * Strategy:
 *   - Each test gets its own `FOLIO_CONFIG_DIR` (tmp dir) and a separate
 *     localRoot tmp dir, so tests don't interfere.
 *   - The pod is the `FsBackedMockPodClient`, persisted to a JSON file at
 *     `FOLIO_MOCK_POD_FILE` so multiple CLI invocations within one test
 *     share the same "pod" state.
 *   - We spawn `node src/cli.js <cmd>` with a piped stdin.  For interactive
 *     commands we feed the answers up front (newline-separated).
 *
 * Coverage map:
 *   init            happy path + already-exists overwrite=no
 *   sync            5-file round trip (push + pull) + idempotent rerun
 *   status          prints expected counts; with last-sync after a sync
 *   share           prints valid PodCapabilityToken JSON
 *   conflicts       lists conflicted files; --resolve gracefully skips when $EDITOR unset
 *   rm              tombstones a file; subsequent sync doesn't re-download
 *   --help          exits 0
 *   unknown cmd     exits 2
 *   no config       exits 1 with a clear message
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs }   from 'node:fs';
import { spawn }            from 'node:child_process';
import { tmpdir }           from 'node:os';
import { join, dirname }    from 'node:path';
import { fileURLToPath }    from 'node:url';

import {
  PodCapabilityToken,
} from '@onderling/core';

const HERE     = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(HERE, '..', 'src', 'cli.js');

// ── Spawn helper ────────────────────────────────────────────────────────────

/**
 * Run `node cli.js <args...>` with the given env + stdin.
 *
 * @param {object}   opts
 * @param {string[]} opts.args
 * @param {object}   [opts.env]
 * @param {string}   [opts.stdin]    — string to pipe into stdin (CR-stripped)
 * @returns {Promise<{ code:number, stdout:string, stderr:string }>}
 */
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
  cfgDir    = await fs.mkdtemp(join(tmpdir(), 'folio-cfg-'));
  localRoot = await fs.mkdtemp(join(tmpdir(), 'folio-local-'));
  podFile   = join(await fs.mkdtemp(join(tmpdir(), 'folio-pod-')), 'pod.json');
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

// 24 valid BIP-39 words used by core's tests (any valid 24-word phrase works;
// using a deterministic one keeps tests stable).
const TEST_PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art';

/**
 * Run `folio init` non-interactively by piping all answers up-front.
 * Defaults are accepted by feeding empty lines.
 */
async function runInit({ webId = 'https://alice.example/profile/card#me', podRoot } = {}) {
  // Prompts in order:
  //   1. localRoot           — accept default (the path passed as arg)
  //   2. WebID               — type webId
  //   3. podRoot             — accept default (derived from WebID)
  //   4. "have phrase?"      — y
  //   5. enter phrase        — TEST_PHRASE
  // If podRoot is given, override step 3.
  const stdin = [
    '',                           // localRoot default
    webId,
    podRoot ?? '',
    'y',
    TEST_PHRASE,
  ].join('\n') + '\n';
  return runCli({
    args:  ['init', localRoot],
    env:   baseEnv(),
    stdin,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('folio --help / unknown / no-args', () => {
  it('--help exits 0 and prints usage', async () => {
    const r = await runCli({ args: ['--help'] });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage:');
    expect(r.stdout).toContain('init');
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

describe('folio init', () => {
  it('persists config + writes a vault + creates the marker file', async () => {
    const r = await runInit();
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Folio is set up.');

    const cfg = JSON.parse(await fs.readFile(join(cfgDir, 'config.json'), 'utf8'));
    expect(cfg.localRoot).toBe(localRoot);
    expect(cfg.podRoot).toBe('https://alice.example/notes/');
    expect(cfg.webId).toBe('https://alice.example/profile/card#me');
    expect(cfg.vaultPath).toBe(join(cfgDir, 'vault.json'));

    const vaultRaw = JSON.parse(await fs.readFile(cfg.vaultPath, 'utf8'));
    expect(vaultRaw.entries['bootstrap-mnemonic']).toBe(TEST_PHRASE);
    expect(typeof vaultRaw.entries['bootstrap-seed-b64']).toBe('string');

    const markerRaw = await fs.readFile(join(localRoot, '.onderling', '.folio-managed'), 'utf8');
    expect(JSON.parse(markerRaw).webId).toBe('https://alice.example/profile/card#me');
  });

  it('refuses to overwrite an existing config when answered "n"', async () => {
    await runInit();
    // Re-run; first prompt is "Overwrite?" — answer "n".
    const r = await runCli({
      args:  ['init', localRoot],
      env:   baseEnv(),
      stdin: 'n\n',
    });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('aborted');
  });
});

describe('folio sync — round trip', () => {
  it('uploads 5 local files + downloads 2 pod-only files; rerun is a no-op', async () => {
    await runInit();

    // Seed local: 5 files.
    for (let i = 0; i < 5; i++) {
      await fs.writeFile(join(localRoot, `note-${i}.md`), `body-${i}`);
    }
    // Seed pod via the same persistence file the CLI uses.
    const cfg = JSON.parse(await fs.readFile(join(cfgDir, 'config.json'), 'utf8'));
    await seedPod(podFile, [
      [`${cfg.podRoot}remote-a.md`, 'remote-a-content'],
      [`${cfg.podRoot}remote-b.md`, 'remote-b-content'],
    ]);

    const r1 = await runCli({ args: ['sync'], env: baseEnv() });
    expect(r1.code).toBe(0);
    expect(r1.stdout).toMatch(/uploads:\s+5/);
    expect(r1.stdout).toMatch(/downloads:\s+2/);

    // Files now present locally.
    expect(await fs.readFile(join(localRoot, 'remote-a.md'), 'utf8')).toBe('remote-a-content');
    expect(await fs.readFile(join(localRoot, 'remote-b.md'), 'utf8')).toBe('remote-b-content');

    // Pod has all 7.
    const pod = JSON.parse(await fs.readFile(podFile, 'utf8'));
    expect(Object.keys(pod.store).filter((u) => u.startsWith(cfg.podRoot)).length).toBe(7);

    // Rerun is idempotent.
    const r2 = await runCli({ args: ['sync'], env: baseEnv() });
    expect(r2.code).toBe(0);
    expect(r2.stdout).toMatch(/uploads:\s+0/);
    expect(r2.stdout).toMatch(/downloads:\s+0/);
  });
});

describe('folio status', () => {
  it('reports last-sync time after a sync, and 0 pending counts', async () => {
    await runInit();
    await fs.writeFile(join(localRoot, 'note.md'), 'hello');
    await runCli({ args: ['sync'], env: baseEnv() });

    const r = await runCli({ args: ['status'], env: baseEnv() });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/last sync:\s+\d{4}-\d{2}-\d{2}T/);
    expect(r.stdout).toMatch(/pending uploads:\s+0/);
    expect(r.stdout).toMatch(/pending downloads:\s+0/);
  });

  it('exits 1 with a clear message when no config exists', async () => {
    const r = await runCli({ args: ['status'], env: baseEnv() });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('no config');
  });
});

describe('folio share', () => {
  it('prints a valid PodCapabilityToken JSON for the configured pod', async () => {
    await runInit();
    const cfg = JSON.parse(await fs.readFile(join(cfgDir, 'config.json'), 'utf8'));

    // The recipient pubkey is opaque to `share` — we don't need it to be
    // a real Ed25519 key, just a base64url-shaped string of the right length.
    // The token's signature is over the issuer's identity + payload; the
    // subject is just metadata.
    const subjB64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

    const r = await runCli({
      args: ['share', 'note.md', '--for', subjB64, '--scope', 'read'],
      env:  baseEnv(),
    });
    expect(r.code).toBe(0);

    const tokenJson = JSON.parse(r.stdout.trim());
    expect(tokenJson.subject).toBe(subjB64);
    expect(tokenJson.pod).toBe(cfg.podRoot);
    expect(tokenJson.scopes).toEqual(['pod.read:/note.md']);
    expect(typeof tokenJson.sig).toBe('string');

    // Verifies as well-formed signed token.
    expect(PodCapabilityToken.verify(tokenJson, cfg.podRoot)).toBe(true);
  });

  it('errors when --for is missing', async () => {
    await runInit();
    const r = await runCli({
      args: ['share', 'note.md', '--scope', 'read'],
      env:  baseEnv(),
    });
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('--for');
  });
});

describe('folio conflicts', () => {
  it('lists files containing conflict markers', async () => {
    await runInit();
    const file = join(localRoot, 'note.md');
    await fs.writeFile(file,
      '<<<<<<< YOURS (local 2026-04-29 00:00 UTC)\nmine\n=======\ntheirs\n>>>>>>> THEIRS (pod 2026-04-29 00:01 UTC)\n');
    // Plus a clean file we should NOT list.
    await fs.writeFile(join(localRoot, 'clean.md'), 'just notes');

    const r = await runCli({ args: ['conflicts'], env: baseEnv() });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('1 conflicted file(s)');
    expect(r.stdout).toContain('note.md');
    expect(r.stdout).not.toContain('clean.md');
  });

  it('--resolve without $EDITOR falls back gracefully', async () => {
    await runInit();
    await fs.writeFile(join(localRoot, 'note.md'),
      '<<<<<<< YOURS\nmine\n=======\ntheirs\n>>>>>>> THEIRS\n');

    const env = { ...baseEnv(), EDITOR: '', VISUAL: '' };
    const r = await runCli({ args: ['conflicts', '--resolve'], env });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('$EDITOR is unset');
  });
});

describe('folio reset', () => {
  it('removes config + vault + per-folder metadata; leaves notes intact', async () => {
    await runInit();

    // Drop a real note alongside the metadata so we can prove it survives.
    await fs.writeFile(join(localRoot, 'keep-me.md'), 'precious user content\n');
    await fs.mkdir(join(localRoot, '.folio'), { recursive: true });
    await fs.writeFile(join(localRoot, '.folio', 'shares.json'), '{}');

    // Pre-conditions: metadata + vault + config all present.
    await fs.access(join(cfgDir, 'config.json'));
    await fs.access(join(cfgDir, 'vault.json'));
    await fs.access(join(localRoot, '.onderling', '.folio-managed'));
    await fs.access(join(localRoot, '.folio', 'shares.json'));

    const r = await runCli({ args: ['reset', '--yes'], env: baseEnv() });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('removed');

    // Settings gone.
    await expect(fs.access(join(cfgDir, 'config.json'))).rejects.toThrow();
    await expect(fs.access(join(cfgDir, 'vault.json'))).rejects.toThrow();
    await expect(fs.access(join(localRoot, '.onderling'))).rejects.toThrow();
    await expect(fs.access(join(localRoot, '.folio'))).rejects.toThrow();

    // User content untouched.
    expect(await fs.readFile(join(localRoot, 'keep-me.md'), 'utf8'))
      .toBe('precious user content\n');
  });

  it('--dry-run lists targets without deleting anything', async () => {
    await runInit();
    const r = await runCli({ args: ['reset', '--dry-run'], env: baseEnv() });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('config');
    expect(r.stdout).toContain('vault');
    expect(r.stdout).toContain('Dry run');
    // Files still there.
    await fs.access(join(cfgDir, 'config.json'));
    await fs.access(join(cfgDir, 'vault.json'));
  });

  it('declining the prompt aborts with exit code 2 and leaves files', async () => {
    await runInit();
    const r = await runCli({ args: ['reset'], env: baseEnv(), stdin: 'n\n' });
    expect(r.code).toBe(2);
    expect(r.stdout).toContain('Aborted');
    await fs.access(join(cfgDir, 'config.json')); // still present
  });

  it('reports nothing-to-do when no settings exist', async () => {
    // Fresh cfgDir with nothing in it; no localRoot config either.
    const r = await runCli({ args: ['reset', '--yes'], env: baseEnv() });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('nothing to remove');
  });
});

describe('folio rm', () => {
  it('tombstones a file so subsequent sync does not re-download it', async () => {
    await runInit();
    const cfg = JSON.parse(await fs.readFile(join(cfgDir, 'config.json'), 'utf8'));

    // Pod has a file; first sync downloads it.
    await seedPod(podFile, [[`${cfg.podRoot}gone.md`, 'pod-content']]);
    await runCli({ args: ['sync'], env: baseEnv() });
    expect(await fs.readFile(join(localRoot, 'gone.md'), 'utf8')).toBe('pod-content');

    // Delete locally, then tombstone via folio rm so it doesn't come back.
    await fs.rm(join(localRoot, 'gone.md'));
    const rmR = await runCli({ args: ['rm', 'gone.md'], env: baseEnv() });
    expect(rmR.code).toBe(0);
    expect(rmR.stdout).toContain('tombstoned');

    const r = await runCli({ args: ['sync'], env: baseEnv() });
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/downloads:\s+0/);
    await expect(fs.access(join(localRoot, 'gone.md'))).rejects.toThrow();
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Pre-seed the FsBackedMockPodClient persistence file with given entries.
 * @param {string} podFile
 * @param {Array<[string, string]>} entries  uri/content pairs
 */
async function seedPod(podFile, entries) {
  let raw = { store: {}, tombstones: [], etagCounter: 0 };
  try {
    raw = JSON.parse(await fs.readFile(podFile, 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  for (const [uri, content] of entries) {
    raw.store[uri] = {
      content,
      contentType:  'text/markdown',
      lastModified: new Date().toUTCString(),
      etag:         `"e${++raw.etagCounter}"`,
      size:         Buffer.byteLength(content, 'utf8'),
    };
  }
  await fs.mkdir(dirname(podFile), { recursive: true });
  await fs.writeFile(podFile, JSON.stringify(raw), 'utf8');
}
