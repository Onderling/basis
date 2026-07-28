/**
 * FITNESS FUNCTION — web/mobile shells are thin adapters, not logic owners.
 *
 * CLAUDE.md invariant #1: dispatch / resolution / routing logic lives ONCE in
 * shared `src/`; the web (web/v2) and mobile (basis-mobile/src) shells are
 * platform UI + the transport/bundle adapter, nothing else. The canonical
 * waist primitives — parseInput · mergeManifests · resolveDispatch · runDispatch
 * — must be DEFINED in shared src/ and only IMPORTED by the shells. Re-declaring
 * one in a shell (the copy-paste that started past drift) FAILS CI here.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));

const GUARDED = ['parseInput', 'mergeManifests', 'resolveDispatch', 'runDispatch'];
// A *definition* of one of the symbols (not an import or a call).
const defRe = (sym) => new RegExp(`(?:export\\s+)?(?:async\\s+)?function\\s+${sym}\\b|(?:export\\s+)?(?:const|let|var)\\s+${sym}\\s*=`);

function jsFiles(root) {
  const out = [];
  const walk = (d) => {
    let entries; try { entries = readdirSync(d); } catch { return; }
    for (const name of entries) {
      if (name === 'node_modules' || name === 'dist' || name.startsWith('.')) continue;
      const full = join(d, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (/\.(js|jsx)$/.test(name) && !/\.test\./.test(name)) out.push(full);
    }
  };
  walk(root);
  return out;
}

const SHELLS = [
  { name: 'web shell (web/v2)', root: dir('../../web/v2') },
  { name: 'mobile shell (basis-mobile/src)', root: dir('../../../basis-mobile/src') },
];

describe('FITNESS: shells define no waist dispatch/resolution logic', () => {
  for (const shell of SHELLS) {
    it(`${shell.name} imports the waist primitives, never re-declares them`, () => {
      const offenders = [];
      for (const file of jsFiles(shell.root)) {
        const src = readFileSync(file, 'utf8');
        for (const sym of GUARDED) {
          if (defRe(sym).test(src)) offenders.push(`${file.split('/onderling-mono/')[1] ?? file} defines ${sym}`);
        }
      }
      expect(offenders, `shell re-declares shared logic (move it to src/ + import):\n${offenders.join('\n')}`).toEqual([]);
    });
  }

  it('the guarded primitives ARE defined in shared src/ (the guard stays meaningful)', () => {
    const srcFiles = jsFiles(dir('../../src'));
    for (const sym of GUARDED) {
      const defined = srcFiles.some((f) => defRe(sym).test(readFileSync(f, 'utf8')));
      expect(defined, `${sym} should be defined in shared src/ — guard is stale if not`).toBe(true);
    }
  });
});
