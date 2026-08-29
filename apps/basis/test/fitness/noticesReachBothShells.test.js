/**
 * FITNESS — every notice the system can say reaches BOTH shells.
 *
 * A notice module (`src/v2/*Notice.js`) is a pure decision: given the folded roster, the viewer, and the
 * verified statements, "is there something this person should be told?". It is shared by construction.
 * What has NOT been shared is the delivery: each shell computes the notice in its own paint code and
 * appends a local bubble. So a notice added to one shell stays there — and on 2026-08-29 a phone that
 * had just been removed from a circle received the eviction statement and showed nothing, while the
 * admin's app reported `told: true` (W23).
 *
 * The plan's Phase 2 moves delivery onto the event log (a `notification` entry written once, painted by
 * both shells through the shared projection). Until that lands, this guard holds the line the cheap way:
 * a notice module that exists must be consumed by both shells, and the ONE known gap is a dated baseline
 * that may only shrink — a closed gap left in the list fails the test too.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));

const NOTICE_DIR = dir('../../src/v2/');
const SHELLS = {
  web:    [dir('../../web/v2/')],
  mobile: [dir('../../../basis-mobile/src/'), dir('../../../basis-mobile/')],
};

/**
 * Known gaps: `<module> → <shell>`. Each dated, each a defect on the plan. Shrinks only.
 */
const KNOWN_GAPS = new Set([
  // Empty, and that is the point: `removalNotice → mobile` was the one entry (W23 — a removed phone was
  // told nothing while the admin's app reported `told: true`). It was closed the same day by moving the
  // decision AND the write into `sayRemovalNotice`, which both shells now call. An entry here is a defect
  // with a date and a plan item, never a way to make this file green.
]);

const noticeModules = readdirSync(NOTICE_DIR).filter((f) => /Notice\.js$/.test(f) && !f.endsWith('.test.js'));

/** Every .js file under a root (shallow + one level of screens/core), read once. */
function sourcesUnder(root) {
  const out = [];
  const walk = (d, depth) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (depth < 4) walk(p, depth + 1); }
      else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push(readFileSync(p, 'utf8'));
    }
  };
  walk(root, 0);
  return out.join('\n');
}

const shellSource = Object.fromEntries(
  Object.entries(SHELLS).map(([name, roots]) => [name, roots.map(sourcesUnder).join('\n')]),
);
// The shared conversation projection both shells call (`chatRows` → membershipNotices). A notice module
// consumed HERE reaches both shells by construction — the stronger form of the invariant — so it counts
// for both, and a shell no longer has to import it at all.
const PROJECTION = ['../../src/v2/membershipNotices.js', '../../src/v2/circleStream.js']
  .map((rel) => readFileSync(dir(rel), 'utf8')).join('\n');

describe('FITNESS — notices reach both shells', () => {
  it('finds the notice modules', () => {
    expect(noticeModules.length, 'src/v2/*Notice.js').toBeGreaterThan(0);
  });

  for (const file of noticeModules) {
    const mod = file.replace(/\.js$/, '');
    for (const shell of Object.keys(SHELLS)) {
      const key = `${mod} → ${shell}`;
      it(`${key}`, () => {
        const consumed = new RegExp(`\\b${mod}\\b`).test(shellSource[shell]) || new RegExp(`\\b${mod}\\b`).test(PROJECTION);
        if (KNOWN_GAPS.has(key)) {
          expect(consumed, `${key} is listed as a known gap but the shell consumes it now — remove it from KNOWN_GAPS`).toBe(false);
        } else {
          expect(consumed, `${key}: a notice one shell can say and the other cannot (invariant 2, web ≡ mobile)`).toBe(true);
        }
      });
    }
  }

  it('lists no phantom gaps', () => {
    const mods = new Set(noticeModules.map((f) => f.replace(/\.js$/, '')));
    const phantom = [...KNOWN_GAPS].filter((g) => !mods.has(g.split(' → ')[0]));
    expect(phantom, 'a KNOWN_GAPS entry names a module that does not exist').toEqual([]);
  });
});
