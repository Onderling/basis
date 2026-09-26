/**
 * The circle's policy on the governance lane — the fold, the authority, the head. The lane's own crossing (a joiner
 * catching the founder's policy up) is `circlePolicyReachesAJoiner.relay.test.js`.
 */
import { describe, it, expect } from 'vitest';
import {
  foldPolicyUpdates, denyWinsMerge, applyPolicyUpdates, makePolicyHeadStore, nextPolicyVersion,
  preservedPolicyStatementsFor, POLICY_UPDATE_KIND,
} from '../../src/v2/policyUpdateLane.js';

const body = (author, version, policy, hash) => ({ kind: POLICY_UPDATE_KIND, author, hash, payload: { policy, version } });
const admins = new Set(['anna', 'bram']);

describe('foldPolicyUpdates', () => {
  it('the highest version from an admin wins', () => {
    const won = foldPolicyUpdates([body('anna', 1, { storagePosture: 'p0' }, 'h1'), body('anna', 2, { storagePosture: 'p2' }, 'h2')], { admins });
    expect(won.policy.storagePosture).toBe('p2');
    expect(won.version).toBe(2);
  });
  it('a member who is not an admin states nothing — deny by default', () => {
    expect(foldPolicyUpdates([body('cees', 9, { storagePosture: 'p0' }, 'h9')], { admins })).toBeNull();
    const won = foldPolicyUpdates([body('anna', 1, { storagePosture: 'p2' }, 'h1'), body('cees', 9, { storagePosture: 'p0' }, 'h9')], { admins });
    expect(won.policy.storagePosture).toBe('p2');
  });
  it('two admins at the same version: deny-wins per axis, the same answer in either order', () => {
    const a = body('anna', 3, { storagePosture: 'p0', llmTool: 'cloud', view: 'chat', features: { chat: true, tasks: true } }, 'hA');
    const b = body('bram', 3, { storagePosture: 'p2', llmTool: 'local', view: 'screen', features: { chat: true, tasks: false } }, 'hB');
    const one = foldPolicyUpdates([a, b], { admins });
    const two = foldPolicyUpdates([b, a], { admins });
    expect(one).toEqual(two);
    expect(one.policy.storagePosture).toBe('p2');          // sealed beats plaintext
    expect(one.policy.llmTool).toBe('local');
    expect(one.policy.features).toEqual({ chat: true, tasks: false });   // off beats on
    expect(one.policy.view).toBe('screen');                // no deny order: the higher hash's value
  });
});

describe('denyWinsMerge', () => {
  it('one policy is itself', () => { const p = { storagePosture: 'p1' }; expect(denyWinsMerge([p])).toBe(p); });
});

function memIo() { const m = new Map(); return { getItem: async (k) => m.get(k) ?? null, setItem: async (k, v) => { m.set(k, v); } }; }
function rail(stored) {
  return { storedStatements: () => stored, readVerifiedBodies: async () => ({ bodies: stored.map((s) => s.body) }) };
}

describe('applyPolicyUpdates', () => {
  it('writes the folded policy once, keeps the head + the original statement, and serves it at catch-up', async () => {
    const stmt = { body: body('anna', 1, { storagePosture: 'p2' }, 'h1'), sig: 'sig' };
    const headStore = makePolicyHeadStore(memIo());
    const written = [];
    const args = { rail: rail([stmt]), circleId: 'c', adminsOf: async () => admins, headStore, writePolicy: async (c, p) => { written.push(p); } };
    expect(await applyPolicyUpdates(args)).toEqual({ applied: true, version: 1 });
    expect(await applyPolicyUpdates(args)).toEqual({ applied: false });   // idempotent
    expect(written).toEqual([{ storagePosture: 'p2' }]);
    expect(await preservedPolicyStatementsFor({ headStore, circleId: 'c' })).toEqual([stmt]);
    expect(await nextPolicyVersion(headStore, 'c')).toBe(2);
  });
  it('a second admin\'s statement at the same version, arriving later, re-applies the merge', async () => {
    const s1 = { body: body('anna', 4, { storagePosture: 'p0' }, 'hZ'), sig: 's' };
    const s2 = { body: body('bram', 4, { storagePosture: 'p2' }, 'hA'), sig: 's' };   // lower hash
    const headStore = makePolicyHeadStore(memIo());
    const written = [];
    const base = { circleId: 'c', adminsOf: async () => admins, headStore, writePolicy: async (c, p) => { written.push(p.storagePosture); } };
    await applyPolicyUpdates({ ...base, rail: rail([s1]) });
    await applyPolicyUpdates({ ...base, rail: rail([s1, s2]) });
    expect(written).toEqual(['p0', 'p2']);
  });
  it('an older version never overwrites a newer head', async () => {
    const headStore = makePolicyHeadStore(memIo());
    await headStore.write('c', { version: 5, key: 'x' });
    const r = await applyPolicyUpdates({ rail: rail([{ body: body('anna', 2, { storagePosture: 'p0' }, 'h2'), sig: 's' }]), circleId: 'c', adminsOf: async () => admins, headStore, writePolicy: async () => { throw new Error('must not write'); } });
    expect(r.applied).toBe(false);
  });
});

describe('makeCirclePolicyLane — state', () => {
  it('states one version past the head and makes its own statement the head, so the next save counts up', async () => {
    const { makeCirclePolicyLane } = await import('../../src/v2/policyUpdateLane.js');
    const headStore = makePolicyHeadStore(memIo());
    const said = [];
    const lane = makeCirclePolicyLane({
      emitter: () => async (u) => { said.push(u.version); return { body: { hash: `h${u.version}` }, sig: 's' }; },
      headStore, readPolicy: async () => ({ storagePosture: 'p2' }), writePolicy: async () => {}, adminsOf: async () => admins,
    });
    await lane.state('c'); await lane.state('c');
    expect(said).toEqual([1, 2]);
    expect(await lane.preserved('c')).toEqual([{ body: { hash: 'h2' }, sig: 's' }]);
  });
  it('without the agent yet (before boot) states nothing', async () => {
    const { makeCirclePolicyLane } = await import('../../src/v2/policyUpdateLane.js');
    const lane = makeCirclePolicyLane({ emitter: () => null, headStore: makePolicyHeadStore(memIo()), readPolicy: async () => ({}), writePolicy: async () => {}, adminsOf: async () => admins });
    expect(await lane.state('c')).toBeNull();
  });
});
