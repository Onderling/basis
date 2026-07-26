/**
 * Fitness — the wake rule exists TWICE and the two copies must agree.
 *
 * `governanceWakeHint` (basis, `src/v2/governanceLog.js`) is the canonical answer to "which governance
 * events may nudge an offline device". stoop's `broadcastKringGovernance` cannot import it — invariant #5
 * forbids stoop reaching into basis app code — so it re-derives the rule inline:
 *
 *     const wakes = !!a.event && a.event.event === 'propose';
 *
 * The duplication is legitimate; the SILENCE around it is not. If governance ever grows a second
 * wake-worthy event kind, `governanceLog.js` would be updated and the stoop skill would quietly keep the
 * old rule — and the failure is invisible in both directions: an under-wake is a decision nobody hears
 * about, an over-wake is a notification storm that gets the circle muted. Neither shows up in a unit test
 * of either side alone.
 *
 * So: drive BOTH and require the same verdict on the same events. Source-read for the stoop half, because
 * the rule there is an inline expression, not an exported function.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { governanceWakeHint, GOV_EVENT } from '../../src/v2/governanceLog.js';

const stoopSrc = () => readFileSync(new URL('../../../stoop/src/skills/index.js', import.meta.url), 'utf8');

/**
 * stoop's rule, extracted from its source so this test reads what SHIPS rather than a copy of it.
 * Deliberately brittle about the shape: if the expression is refactored, this fails loudly and a human
 * re-points it, which is far better than it silently matching nothing and passing.
 */
function stoopWakeRule() {
  const m = stoopSrc().match(/const wakes = !!a\.event && a\.event\.event === '([a-z]+)';/);
  expect(m, "stoop's inline wake rule was not found — re-point this guard at its new shape").toBeTruthy();
  const wakeEvent = m[1];
  return (event) => !!event && event.event === wakeEvent;
}

describe('the wake rule agrees across the stoop/basis boundary', () => {
  const EVENTS = [
    { event: GOV_EVENT.PROPOSE, proposalId: 'p1', by: 'anna' },
    { event: GOV_EVENT.VOTE, proposalId: 'p1', voter: 'bram', choice: 'yes' },
    { event: GOV_EVENT.RESOLVE, proposalId: 'p1', status: 'approved' },
    { event: 'some-future-kind', proposalId: 'p1' },
    null,
    undefined,
    {},
  ];

  it('both copies give the SAME verdict for every governance event kind', () => {
    const stoop = stoopWakeRule();
    for (const e of EVENTS) {
      expect(stoop(e), `disagreement on ${JSON.stringify(e)}`).toBe(governanceWakeHint(e));
    }
  });

  it('…and the shared verdict is the intended one: only a decision OPENING wakes', () => {
    // Non-vacuous: without this, both copies returning `false` for everything would still "agree".
    const stoop = stoopWakeRule();
    expect(governanceWakeHint({ event: GOV_EVENT.PROPOSE })).toBe(true);
    expect(stoop({ event: GOV_EVENT.PROPOSE })).toBe(true);
    expect(governanceWakeHint({ event: GOV_EVENT.VOTE })).toBe(false);
    expect(stoop({ event: GOV_EVENT.VOTE })).toBe(false);
  });

  it('the stoop skill still stamps `noWake` as the INVERSE of its rule', () => {
    // The rule agreeing is not enough — it has to be wired the right way round. Inverting this line would
    // wake on every vote and stay silent on the decision, and every rule test above would still pass.
    expect(stoopSrc()).toContain('noWake: !wakes,');
  });

  it('a REPORT fan is unconditionally silent — it is not governed by the rule at all', () => {
    // §8 reports are about a person; a buzzing phone is a disclosure of its own. Pinned separately so
    // nobody "unifies" it with the governance gate and makes reports wake.
    const src = stoopSrc();
    const start = src.indexOf("defineSkill('broadcastKringReport'");
    expect(start, 'broadcastKringReport not found').toBeGreaterThan(-1);
    // Bounded by the skill's own descriptor block rather than a character count, so the guard does not
    // start failing because the handler grew a few lines.
    const body = src.slice(start, src.indexOf('visibility:', start));
    expect(body).toContain('noWake: true');
    expect(body).not.toContain('noWake: !');        // never derived from the governance rule
  });
});
