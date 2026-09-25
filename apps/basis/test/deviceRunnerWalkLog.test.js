/**
 * THE BOX'S WALK LOG IS WRITTEN — to a directory, with the directory made.
 *
 * The box role starts the runner with `--walk-log /data/assistant/walks/` (a directory, the way an operator
 * names "put the logs here"). The runner turned that into `/data/assistant/walks/-<stamp>` — a file with no
 * name in a directory nobody had created — and every write was swallowed (the log is not the product), so
 * the first personal box ran for a day without a single walk-log line while printing the path of one. A
 * directory is a directory: the file goes in it under the runner's own name, and the directory is made.
 *
 * Spawned for real, without a relay (a local-only boot is enough to write the `run` entry).
 */
import { describe, it, expect, afterAll } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RUNNER = fileURLToPath(new URL('../bin/device-runner.mjs', import.meta.url));

function run(args, { env }) {
  const child = spawn(process.execPath, [RUNNER, ...args], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const state = { child, out: '' };
  child.stdout.on('data', (b) => { state.out += String(b); });
  child.stderr.on('data', (b) => { state.out += String(b); });
  state.exited = new Promise((resolve) => child.on('exit', (code) => resolve(code)));
  return state;
}
// "Up" is the banner's LAST line — the walk-log path — not its first: the banner is several writes, and under
// load the pipe hands them over in separate chunks, so reading at "device-runner: up" could miss the path.
const untilUp = async (proc, ms = 60_000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (/device-runner: up[\s\S]*\n {2}walk log {2}\S+\n/.test(proc.out)) return true;
    await new Promise((r) => { setTimeout(r, 200); });
  }
  return false;
};

describe('the walk log lands where --walk-log points', () => {
  const dirs = [];
  const procs = [];
  afterAll(async () => {
    for (const p of procs) { try { p.child.kill('SIGTERM'); } catch { /* */ } }
    await new Promise((r) => { setTimeout(r, 500); });
    for (const p of procs) { try { p.child.kill('SIGKILL'); } catch { /* */ } }
    for (const d of dirs) { try { rmSync(d, { recursive: true, force: true }); } catch { /* */ } }
  });

  it('a directory (trailing slash, not yet existing) gets a stamped file inside it', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-walklog-')); dirs.push(dataDir);
    const walks = path.join(dataDir, 'walks') + path.sep;   // the box's shape: "/data/assistant/walks/"
    const env = { PATH: process.env.PATH, HOME: dataDir, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase' };
    const proc = run(['--data-dir', dataDir, '--walk-log', walks], { env }); procs.push(proc);
    expect(await untilUp(proc), `the runner never came up:\n${proc.out.slice(-1200)}`).toBe(true);
    expect(existsSync(walks), 'the directory is made').toBe(true);
    const files = readdirSync(walks).filter((f) => f.endsWith('.jsonl'));
    expect(files.length, `one walk-log file in ${walks}: ${JSON.stringify(readdirSync(walks))}`).toBe(1);
    const lines = readFileSync(path.join(walks, files[0]), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
    expect(lines.find((e) => e.kind === 'run'), 'the run entry is in it').toBeTruthy();
    expect(proc.out, 'the path the runner prints is the file it writes').toContain(path.join(walks, files[0]));
  }, 90_000);

  it('a file path keeps its name, stamped before the extension', async () => {
    const dataDir = mkdtempSync(path.join(tmpdir(), 'basis-walklog-')); dirs.push(dataDir);
    const file = path.join(dataDir, 'logs', 'box.jsonl');   // the directory does not exist yet either
    const env = { PATH: process.env.PATH, HOME: dataDir, BASIS_VAULT_PASSPHRASE: 'test-only-passphrase' };
    const proc = run(['--data-dir', dataDir, '--walk-log', file], { env }); procs.push(proc);
    expect(await untilUp(proc), `the runner never came up:\n${proc.out.slice(-1200)}`).toBe(true);
    const files = readdirSync(path.join(dataDir, 'logs'));
    expect(files.length).toBe(1);
    expect(files[0]).toMatch(/^box-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.jsonl$/);
  }, 90_000);
});
