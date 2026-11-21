/**
 * A DECIDED SETTINGS CHANGE IS STATED FIRST, WRITTEN ONLY WHEN STATED. The enactor (a proposal the circle accepted) used
 * to write the change on this device and then try to state it; a failed statement left this device alone holding the
 * change. Now it goes through the same save as an admin's settings save: the decided settings are stated with the
 * proposal that decided them, and written here only when the statement went out; otherwise the enact failed (the
 * governance panel says so).
 */
import { describe, it, expect } from 'vitest';
import { policyEnactor } from '../../src/v2/governanceAppWiring.js';
import { makeCirclePolicyLane, makePolicyHeadStore, saveCircleSettings } from '../../src/v2/policyUpdateLane.js';

const memIo = () => { const m = new Map(); return { load: async (k) => m.get(k) ?? null, save: async (k, v) => { m.set(k, v); } }; };

function setup(emit) {
  const stored = new Map([['c', { features: { tasks: true } }]]);
  const lane = makeCirclePolicyLane({
    emitter: () => emit,
    headStore: makePolicyHeadStore(memIo()),
    readPolicy: async (cid) => stored.get(cid) ?? {},
    writePolicy: async (cid, p) => { stored.set(cid, p); },
    adminsOf: async () => new Set(),
  });
  const enact = policyEnactor({ saveSettings: (cid, patch, meta) => saveCircleSettings({ lane, circleId: cid, policy: patch, proposalId: meta?.proposalId ?? null }) });
  return { stored, enact };
}

describe('the settings enactor', () => {
  it('a statement that fails: the enact fails and nothing is written here', async () => {
    const { stored, enact } = setup(async () => null);
    expect(await enact('c', { features: { tasks: false } }, { proposalId: 'prop-1' })).toEqual({ ok: false, error: 'not-stated' });
    expect(stored.get('c').features.tasks).toBe(true);
  });

  it('stated with the deciding proposal, then written', async () => {
    const said = [];
    const { stored, enact } = setup(async (u) => { said.push(u); return { body: { hash: 'h1' }, sig: 's' }; });
    expect(await enact('c', { features: { tasks: false } }, { proposalId: 'prop-2' })).toEqual({ ok: true, stated: true });
    expect(said[0].proposalId).toBe('prop-2');
    expect(said[0].policy.features.tasks).toBe(false);
    expect(stored.get('c').features.tasks).toBe(false);
  });
});
