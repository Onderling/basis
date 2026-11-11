/**
 * FITNESS — every peer message an agent of ours sends leaves through ONE gate.
 *
 * The circle used to travel as an optional `circleId` beside a raw address, and every caller that reached the secure
 * agent's `peer.sendTo` could forget it: a send to a member's per-circle address then left unscoped and signed with the
 * canonical key, was reported delivered, and was refused at the other end (found on the emulator, 2026-11-11). The
 * agent's `peerSend` (realAgent) now asks the roster what an address is, and `wireSend` beneath it is the one wire
 * call, writing one decision record per send. A second `peer.sendTo(` anywhere in app or package code is a route
 * around both; this test fails on it.
 *
 * Declared exceptions, each one call with its reason (not a baseline: a new one needs a reason here):
 *   - realAgent.js: `wireSend` itself.
 *   - v2/screenView.js: `sendToBot`. The screen view runs its OWN secure agent and speaks to one bot only; it has no
 *     circles and no roster, so the gate has nothing to decide there.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const ROOTS = ['apps', 'packages'];
const SKIP_DIR = new Set(['node_modules', 'dist', 'build', 'test', 'tests', 'e2e', 'test-browser', '__tests__', 'android', 'ios']);
// the package that DEFINES the send is not a caller of it; the journeys are tests that drive bare secure agents on purpose
const SKIP_PREFIX = ['packages/secure-agent/', 'apps/e2e-journeys/'];

const ALLOWED = {
  'apps/basis/src/core/agent/realAgent.js': { count: 1, inside: 'async function wireSend(' },
  'apps/basis/src/v2/screenView.js': { count: 1, inside: 'const sendToBot = ' },
};

function sourceFiles() {
  const out = [];
  const walk = (d) => {
    let entries; try { entries = readdirSync(d); } catch { return; }
    for (const name of entries) {
      if (SKIP_DIR.has(name) || name.startsWith('.')) continue;
      const full = join(d, name);
      let st; try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (/\.(m?js|jsx)$/.test(name) && !/\.test\./.test(name)) out.push(full);
    }
  };
  for (const r of ROOTS) walk(join(REPO, r));
  return out;
}

/** Lines that CALL peer.sendTo (a comment that names it is not a call). */
function sendToCalls(src) {
  return src.split('\n')
    .map((line, i) => ({ line, n: i + 1 }))
    .filter(({ line }) => /\.peer\??\.sendTo\(/.test(line) && !/^\s*(\/\/|\*)/.test(line));
}

describe('one send gate: no peer.sendTo( outside it', () => {
  const files = sourceFiles();

  it('scans a real tree (the walk found the agent)', () => {
    expect(files.some((f) => f.endsWith('apps/basis/src/core/agent/realAgent.js'))).toBe(true);
  });

  it('no app or package code calls peer.sendTo except the declared exceptions', () => {
    const offenders = [];
    for (const f of files) {
      const rel = relative(REPO, f).split('\\').join('/');
      if (SKIP_PREFIX.some((p) => rel.startsWith(p))) continue;
      const calls = sendToCalls(readFileSync(f, 'utf8'));
      if (!calls.length) continue;
      const allowed = ALLOWED[rel];
      if (allowed && calls.length <= allowed.count) continue;
      offenders.push(...calls.map((c) => `${rel}:${c.n}  ${c.line.trim().slice(0, 100)}`));
    }
    expect(offenders, 'send through the agent\'s peerSend (realAgent), not the secure agent directly').toEqual([]);
  });

  it('each declared exception is still where its reason says', () => {
    for (const [rel, { inside }] of Object.entries(ALLOWED)) {
      const src = readFileSync(join(REPO, rel), 'utf8');
      const calls = sendToCalls(src);
      expect(calls.length, `${rel}: the exception is gone; remove it from ALLOWED`).toBe(1);
      const lines = src.split('\n');
      const at = calls[0].n - 1;
      const window = lines.slice(Math.max(0, at - 12), at + 1).join('\n');
      expect(window.includes(inside), `${rel}: peer.sendTo is no longer inside ${inside}`).toBe(true);
    }
  });
});
