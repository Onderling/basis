/**
 * The banner the shipped boot prints says what the node IS — not what an early slice was. It is the operator's one
 * view of the node: a banner saying "no gate" over a node whose gate is on (or the other way round) is a wrong
 * reading of the one thing that decides who may call it.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const BOOT = fileURLToPath(new URL('../src/boot.js', import.meta.url));
const cleanups = [];
afterEach(() => { while (cleanups.length) { try { cleanups.pop()(); } catch { /* */ } } });

describe('the boot banner', () => {
  it('names the gate as it is (on), and no early slice', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'companion-boot-'));
    cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
    const child = spawn(process.execPath, [BOOT], { env: { PATH: process.env.PATH, COMPANION_NODE_CONFIG_DIR: dir, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] });
    cleanups.push(() => child.kill('SIGKILL'));
    let out = '';
    child.stdout.on('data', (b) => { out += String(b); });
    child.stderr.on('data', (b) => { out += String(b); });
    const end = Date.now() + 30_000;
    while (!/Card:/.test(out) && Date.now() < end) await new Promise((r) => { setTimeout(r, 100); });
    expect(out, out).toMatch(/Card:/);
    expect(out).not.toMatch(/Slice R1|no gate/);
    expect(out).toMatch(/gate on/);
  }, 40_000);
});
