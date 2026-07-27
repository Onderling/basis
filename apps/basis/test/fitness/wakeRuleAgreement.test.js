/**
 * Fitness — the wake rule exists ONCE.
 *
 * ── RETIRED IN PART, 2026-07-27 ──────────────────────────────────────────────────────────────────────────
 * This file used to drive TWO copies of the rule and require them to agree: `governanceWakeHint` in basis,
 * and an inline `a.event.event === 'propose'` in stoop's `broadcastKringGovernance`, which existed because
 * stoop cannot import basis app code (invariant #5). The duplication is GONE — the rule moved to the shared
 * substrate table (`@onderling/item-store` `entryKinds.js`) and both now call `kindWakes`.
 *
 * What remains is the guard that matters: **that the duplication does not come back**, and that the rule is
 * still wired the right way round. An agreement test between two copies is worth less than a test that
 * there is only one copy.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { governanceWakeHint, GOV_EVENT } from '../../src/v2/governanceLog.js';
import { kindWakes } from '@onderling/item-store';

const stoopSrc = () => readFileSync(new URL('../../../stoop/src/skills/index.js', import.meta.url), 'utf8');

describe('there is exactly one wake rule', () => {
  it('stoop derives the rule from the SHARED table, not from its own copy', () => {
    const src = stoopSrc();
    expect(src, 'stoop should call the shared kindWakes').toContain("kindWakes('governance'");
    // The inline re-derivation this file used to police must not reappear.
    expect(src).not.toMatch(/const wakes = !!a\.event && a\.event\.event === '[a-z]+';/);
  });

  it('the shared rule is still the intended one: only a decision OPENING wakes', () => {
    expect(kindWakes('governance', { event: GOV_EVENT.PROPOSE })).toBe(true);
    expect(kindWakes('governance', { event: GOV_EVENT.VOTE })).toBe(false);
    expect(kindWakes('governance', { event: GOV_EVENT.RESOLVE })).toBe(false);
    expect(kindWakes('governance', null)).toBe(false);
  });

  it('basis agrees with it — `governanceWakeHint` is the same answer', () => {
    // basis keeps its own named helper for readability at the call site; it must not drift from the table.
    for (const e of [{ event: GOV_EVENT.PROPOSE }, { event: GOV_EVENT.VOTE }, { event: 'future-kind' }, null]) {
      expect(governanceWakeHint(e)).toBe(kindWakes('governance', e));
    }
  });

  it('the stoop skill still stamps `noWake` as the INVERSE of the rule', () => {
    // Agreeing on the rule is not enough — it has to be wired the right way round. Inverting this line
    // would wake on every vote and stay silent on the decision, and every rule test above would pass.
    expect(stoopSrc()).toContain('noWake: !wakes,');
  });

  it('a REPORT fan is unconditionally silent — not governed by the rule at all', () => {
    const src = stoopSrc();
    const start = src.indexOf("defineSkill('broadcastKringReport'");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('visibility:', start));
    expect(body).toContain('noWake: true');
    expect(body).not.toContain('noWake: !');
  });
});
