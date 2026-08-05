/**
 * FITNESS — pairing a household sync peer always names the CIRCLE.
 *
 * `agent.addCirclePeer(circleId, addr)` has been per-circle since a77371cd. A stale one-argument call
 * survived in `basis-mobile/src/screens/ChatScreen.js` until 2026-07-30: it read a roster for circle X and
 * paired every member into whatever circle was active (or a legacy bucket). It read perfectly plausibly,
 * `src/screens/**` has no unit coverage, and nothing failed — which is the failure mode this repo keeps
 * having to undo.
 *
 * Two guards, because the bug had two halves:
 *   1. no shell may call `addCirclePeer` with a single argument — the arity IS the circle scoping;
 *   2. feeding a whole ROSTER goes through the shared `feedHouseholdRoster`, never an inline loop. That
 *      helper also resyncs and binds each member's per-circle address to their key; the inline copy did
 *      neither, so the circles it touched were mis-scoped AND unsealable.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));

const SHELLS = [
  { name: 'web shell (web/v2)', root: dir('../../web/v2') },
  { name: 'mobile shell (basis-mobile/src)', root: dir('../../../basis-mobile/src') },
];

function jsFiles(root) {
  const out = [];
  const walk = (d) => {
    let entries; try { entries = readdirSync(d); } catch { return; }
    for (const name of entries) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
      const full = join(d, name);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(name) && !/\.test\./.test(name)) out.push(full);
    }
  };
  walk(root);
  return out;
}

/**
 * Every `addCirclePeer(...)` call in `src`, with the number of TOP-LEVEL arguments it passes.
 * Counted by walking the parentheses rather than by regex, so a nested call or a template literal in an
 * argument does not read as a second argument.
 */
function addHouseholdPeerCalls(src) {
  const calls = [];
  const needle = 'addCirclePeer(';
  for (let i = src.indexOf(needle); i !== -1; i = src.indexOf(needle, i + 1)) {
    let depth = 0;
    let args = 0;
    let sawContent = false;
    for (let j = i + needle.length - 1; j < src.length; j++) {
      const c = src[j];
      if (c === '(' || c === '[' || c === '{') { depth += 1; continue; }
      if (c === ')' || c === ']' || c === '}') {
        depth -= 1;
        if (depth === 0) { calls.push({ index: i, args: sawContent ? args + 1 : 0 }); break; }
        continue;
      }
      if (depth === 1 && c === ',') { args += 1; continue; }
      if (depth >= 1 && !/\s/.test(c)) sawContent = true;
    }
  }
  return calls;
}

function lineOf(src, index) {
  return src.slice(0, index).split('\n').length;
}

/** Is this offset inside a comment line? Prose about the bug must not read as the bug. */
function inCommentLine(src, index) {
  const line = src.slice(src.lastIndexOf('\n', index) + 1, index).trimStart();
  return line.startsWith('//') || line.startsWith('*') || line.startsWith('/*');
}

describe('FITNESS: household sync peers are paired per circle', () => {
  for (const shell of SHELLS) {
    it(`${shell.name} never calls addCirclePeer without a circle`, () => {
      const offenders = [];
      for (const file of jsFiles(shell.root)) {
        const src = readFileSync(file, 'utf8');
        if (!src.includes('addCirclePeer(')) continue;
        for (const call of addHouseholdPeerCalls(src)) {
          if (call.args === 1 && !inCommentLine(src, call.index)) {
            offenders.push(`${file}:${lineOf(src, call.index)}`);
          }
        }
      }
      expect(offenders, 'addCirclePeer(circleId, addr) — a one-argument call mis-scopes the peer')
        .toEqual([]);
    });

    it(`${shell.name} feeds a roster through the shared feedHouseholdRoster`, () => {
      const offenders = [];
      for (const file of jsFiles(shell.root)) {
        const src = readFileSync(file, 'utf8');
        // A shell that pairs peers in a LOOP is feeding a roster; that is the shared helper's job.
        if (!/for\s*\(([^)]*)\)\s*\{?[^}]{0,200}addCirclePeer\(/s.test(src)) continue;
        offenders.push(file);
      }
      expect(offenders, 'call feedHouseholdRoster({agent, circleId}) instead of looping the roster here')
        .toEqual([]);
    });
  }
});

describe('the shared helper is the one that gets it right', () => {
  it('feedHouseholdRoster passes the circleId first', () => {
    const src = readFileSync(dir('../../src/v2/householdRosterPairing.js'), 'utf8');
    const calls = addHouseholdPeerCalls(src).filter((c) => c.args > 0);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) expect(call.args).toBe(2);
    expect(src).toContain('addCirclePeer(circleId,');
  });
});
