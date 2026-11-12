/**
 * THE START QUEUE (fast start, step 7): what a shell used to fire as a dozen timers at 2–4 s, all at once and each over
 * every circle, runs as ONE queue in shared code: the circle on screen first, then the person's own devices (grants
 * first: a revoke made elsewhere binds before a stale view is served), then every other circle, one at a time.
 */
import { describe, it, expect } from 'vitest';
import { runStartQueue, START_LANES } from '../../src/v2/startQueue.js';

function fakeLanes(log, { slowMs = 5 } = {}) {
  let inFlight = 0; let maxInFlight = 0;
  const lane = (name) => ({
    requestCircle: async (circleId) => {
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      log.push(`${name}:${circleId}`);
      await new Promise((r) => { setTimeout(r, slowMs); });
      inFlight -= 1;
      return { requested: 1 };
    },
  });
  const catchUps = Object.fromEntries(START_LANES.map((k) => [k, lane(k)]));
  const sibling = (name) => ({
    requestFromSiblings: async () => {
      inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
      log.push(`sibling:${name}`);
      await new Promise((r) => { setTimeout(r, slowMs); });
      inFlight -= 1;
    },
  });
  return { catchUps, sibling, max: () => maxInFlight };
}

const circles = (ids) => async (app, op) => (app === 'pinboard' && op === 'listMyCircles' ? { circles: ids } : null);

describe('runStartQueue', () => {
  it('the circle on screen first (every lane), then my own devices (grants first), then the other circles; one at a time', async () => {
    const log = [];
    const f = fakeLanes(log);
    await runStartQueue({
      catchUps: f.catchUps,
      siblings: [['known-peers', f.sibling('known-peers')], ['grants', f.sibling('grants')]],
      callSkill: circles(['a', 'b', 'c']),
      firstCircle: () => 'b',
    });
    const firstOthers = log.findIndex((x) => x.endsWith(':a') || x.endsWith(':c'));
    expect(log.slice(0, START_LANES.length), 'the circle on screen first, all its lanes').toEqual(START_LANES.map((k) => `${k}:b`));
    expect(log[START_LANES.length], 'grants before any other sibling ask').toBe('sibling:grants');
    expect(log.indexOf('sibling:known-peers')).toBeLessThan(firstOthers);
    expect(log.filter((x) => x.endsWith(':a'))).toEqual(START_LANES.map((k) => `${k}:a`));
    expect(log.filter((x) => x.endsWith(':c'))).toEqual(START_LANES.map((k) => `${k}:c`));
    expect(f.max(), 'two steps ran at once').toBe(1);
  });

  it('nothing on screen (the box): own devices, then every circle; a failing lane stops nothing', async () => {
    const log = [];
    const f = fakeLanes(log);
    f.catchUps.gov.requestCircle = async () => { throw new Error('peer gone'); };
    const r = await runStartQueue({ catchUps: f.catchUps, siblings: [['grants', f.sibling('grants')]], callSkill: circles(['a']), firstCircle: () => null });
    expect(log[0]).toBe('sibling:grants');
    expect(log.filter((x) => x.endsWith(':a')).length).toBe(START_LANES.length - 1);
    expect(r.circles).toBe(1);
  });

  it('a circle on screen that is not one of mine is not asked for', async () => {
    const log = [];
    const f = fakeLanes(log);
    await runStartQueue({ catchUps: f.catchUps, siblings: [], callSkill: circles(['a']), firstCircle: () => 'stranger-circle' });
    expect(log.some((x) => x.includes('stranger-circle'))).toBe(false);
  });
});
