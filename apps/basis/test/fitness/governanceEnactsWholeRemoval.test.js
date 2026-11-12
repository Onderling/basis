/**
 * EVERY SHELL'S GOVERNANCE BINDING HANDS ITS AGENT, so a removal governance enacts is the whole removal
 * (`removeCircleMember`: the substrate op, then unbind the member's circle address and re-record the authorize
 * snapshot), never the bare op that leaves a removed member's key in the allowed set on the enacting device.
 *
 * The one exception, declared: the agent's own point binding (realAgent.js `pointGovernance`) only APPENDS events
 * forwarded to the point; it decides and enacts nothing, so it needs no agent.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHELL_FILES = [
  '../../web/v2/circleApp.js',
  '../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js',
  '../../../basis-mobile/src/screens/v2/CircleGovernanceScreen.js',
];
const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

/** Each `bindCircleGovernance({ … })` call's argument text (to its closing `})`). */
function bindings(src) {
  const out = [];
  let i = src.indexOf('bindCircleGovernance({');
  while (i >= 0) {
    if (!/import\s*\{[^}]*$/.test(src.slice(Math.max(0, i - 200), i))) out.push(src.slice(i, src.indexOf('})', i) + 2));
    i = src.indexOf('bindCircleGovernance({', i + 1);
  }
  return out;
}

describe('every shell governance binding hands its agent', () => {
  for (const rel of SHELL_FILES) {
    it(rel.split('/').pop(), () => {
      const calls = bindings(read(rel));
      expect(calls.length, 'the file binds governance').toBeGreaterThan(0);
      for (const c of calls) expect(c, c.slice(0, 160)).toMatch(/\bagent\s*[:,]/);
    });
  }
});
