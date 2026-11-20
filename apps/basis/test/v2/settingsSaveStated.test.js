/**
 * A SETTINGS SAVE IS A STATEMENT TO THE CIRCLE, OR IT IS NOT SAVED. An admin's save used to write the policy on this
 * device first and state it on the governance lane after, swallowing a failed statement: the screen said "saved" while
 * no other member's device ever got the change, so the admin's device differed from every other (a switch-off only the
 * admin held). Now the lane states the policy it is GIVEN and writes it here only when the statement went out.
 */
import { describe, it, expect } from 'vitest';
import { makeCirclePolicyLane, makePolicyHeadStore, saveCircleSettings } from '../../src/v2/policyUpdateLane.js';

const memIo = () => { const m = new Map(); return { load: async (k) => m.get(k) ?? null, save: async (k, v) => { m.set(k, v); } }; };

function laneOver(emit) {
  const stored = new Map([['c', { features: { tasks: true } }]]);
  const lane = makeCirclePolicyLane({
    emitter: () => emit,
    headStore: makePolicyHeadStore(memIo()),
    readPolicy: async (cid) => stored.get(cid) ?? {},
    writePolicy: async (cid, p) => { stored.set(cid, p); },
    adminsOf: async () => new Set(),
  });
  return { lane, stored };
}

describe('a settings save', () => {
  it('a statement that could not be made: not saved, said, and the device keeps the settings it had', async () => {
    const { lane, stored } = laneOver(async () => null);
    const r = await saveCircleSettings({ lane, circleId: 'c', policy: { features: { tasks: false } } });
    expect(r).toEqual({ ok: false, error: 'not-stated' });
    expect(stored.get('c').features.tasks).toBe(true);
  });

  it('an emitter that throws is the same failed save', async () => {
    const { lane, stored } = laneOver(async () => { throw new Error('offline'); });
    expect((await saveCircleSettings({ lane, circleId: 'c', policy: { features: { tasks: false } } })).ok).toBe(false);
    expect(stored.get('c').features.tasks).toBe(true);
  });

  it('stated: saved here too, and the statement carries the settings given (not what the store held)', async () => {
    const said = [];
    const { lane, stored } = laneOver(async (u) => { said.push(u.policy); return { body: { hash: `h${u.version}` }, sig: 's' }; });
    const r = await saveCircleSettings({ lane, circleId: 'c', policy: { features: { tasks: false } } });
    expect(r.ok).toBe(true);
    expect(said.map((p) => p.features.tasks)).toEqual([false]);
    expect(stored.get('c').features.tasks).toBe(false);
  });

  it('no lane (the agent not up yet): not saved', async () => {
    expect(await saveCircleSettings({ lane: null, circleId: 'c', policy: {} })).toEqual({ ok: false, error: 'not-stated' });
  });
});
