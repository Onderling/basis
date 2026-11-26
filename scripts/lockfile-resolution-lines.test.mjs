import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolutionLines } from './lockfile-resolution-lines.mjs';

const WS = [
  "  ws@8.18.0(bufferutil@4.0.8):",
  "    resolution: {integrity: sha512-abc}",
  "    engines: {node: '>=10.0.0'}",
  "    dependencies:",
  "      debug: 4.4.0",
  "",
  "  after@1.0.0:",
  "    deprecated: use something else",
  "    resolution: {integrity: sha512-def}",
].join('\n');

// the same snapshot as pnpm wrote it once on 2026-11-26: the optional peers listed, no version moved
const WS_WITH_PEERS = WS.replace("      debug: 4.4.0\n", "      debug: 4.4.0\n    transitivePeerDependencies:\n      - bufferutil\n      - utf-8-validate\n");

describe('lockfile-resolution-lines', () => {
  it('a transitivePeerDependencies list that comes or goes is not a difference', () => {
    expect(WS_WITH_PEERS).not.toBe(WS);
    expect(resolutionLines(WS_WITH_PEERS)).toBe(resolutionLines(WS));
  });

  it('an item added to an existing list is not a difference either', () => {
    const longer = WS_WITH_PEERS.replace("      - bufferutil\n", "      - bufferutil\n      - supports-color\n");
    expect(resolutionLines(longer)).toBe(resolutionLines(WS_WITH_PEERS));
  });

  it('a deprecated notice or an engines field is not a difference', () => {
    const fresh = WS.replace("use something else", "no longer supported").replace(">=10.0.0", ">=12");
    expect(resolutionLines(fresh)).toBe(resolutionLines(WS));
  });

  it('a moved version, a changed integrity and a changed dependency ARE differences', () => {
    for (const [from, to] of [['ws@8.18.0', 'ws@8.19.0'], ['sha512-abc', 'sha512-xyz'], ['debug: 4.4.0', 'debug: 4.4.1']]) {
      expect(resolutionLines(WS_WITH_PEERS.replace(from, to)), `${from} → ${to}`).not.toBe(resolutionLines(WS_WITH_PEERS));
    }
  });

  it('the list ends where its items end: what follows it is kept, also another list', () => {
    const text = [
      "  a@1.0.0:",
      "    transitivePeerDependencies:",
      "      - x",
      "    os:",
      "      - linux",
      "    dependencies:",
      "      b: 2.0.0",
    ].join('\n');
    expect(resolutionLines(text)).toBe(["  a@1.0.0:", "    os:", "      - linux", "    dependencies:", "      b: 2.0.0"].join('\n'));
  });

  it('on a real lockfile (the phone app\'s): every list is gone, and nothing but those lines and the two metadata fields', () => {
    const real = readFileSync(new URL('../apps/basis-mobile/pnpm-lock.yaml', import.meta.url), 'utf8');
    const kept = resolutionLines(real);
    expect(kept).not.toMatch(/transitivePeerDependencies/);
    const lines = real.split('\n');
    const heads = lines.filter((l) => /^\s+transitivePeerDependencies:\s*$/.test(l)).length;
    expect(heads).toBeGreaterThan(10);
    const meta = lines.filter((l) => /^\s+(deprecated|engines):/.test(l)).length;
    const dropped = lines.length - kept.split('\n').length;
    expect(dropped).toBeGreaterThan(heads * 2 + meta - 1);          // each list has at least one item
    // every kept line is a line of the lockfile, in the lockfile's order
    let at = 0;
    for (const k of kept.split('\n')) { at = lines.indexOf(k, at); expect(at).toBeGreaterThan(-1); at += 1; }
  });
});
