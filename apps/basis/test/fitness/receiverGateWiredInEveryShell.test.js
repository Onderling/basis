/**
 * EVERY SHELL HANDS THE RECEIVER GATE WHAT IT JUDGES BY (web ≡ phone ≡ box).
 *
 * The rules apply judges a carried rules change by the circle's rule in force (`readPolicy`); the policy lane counts
 * the roster (`membersOf`: a member-vote tally needs every member). A shell that leaves either out judges by the
 * defaults instead of the circle's own rule.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const SHELLS = {
  web: ['../../web/v2/circleApp.js'],
  box: ['../../bin/device-runner.mjs'],
  phone: ['../../../basis-mobile/App.js', '../../../basis-mobile/src/core/phoneInboundWiring.js'],
};

/** Each `name({ … })` call's whole argument text (parentheses balanced, so a nested call does not end it early). */
function calls(src, name) {
  const out = [];
  let i = src.indexOf(`${name}({`);
  while (i >= 0) {
    let depth = 0; let j = i + name.length;
    for (; j < src.length; j += 1) {
      if (src[j] === '(') depth += 1;
      else if (src[j] === ')') { depth -= 1; if (depth === 0) break; }
    }
    out.push(src.slice(i, j + 1));
    i = src.indexOf(`${name}({`, i + 1);
  }
  return out;
}

describe('every shell wires the receiver gate', () => {
  for (const [shell, files] of Object.entries(SHELLS)) {
    const src = files.map(read).join('\n');
    it(`${shell}: the rules apply gets the policy in force`, () => {
      const c = calls(src, 'applyRulesUpdates');
      expect(c.length).toBeGreaterThan(0);
      for (const x of c) expect(x).toMatch(/\breadPolicy\s*:/);
    });
    it(`${shell}: the policy lane counts the roster`, () => {
      const c = calls(src, 'makeCirclePolicyLane');
      expect(c.length).toBeGreaterThan(0);
      for (const x of c) {
        expect(x).toMatch(/\bmembersOf\s*:/);
        expect(x).not.toMatch(/\badminsOf\s*:/);
      }
    });
  }
});
