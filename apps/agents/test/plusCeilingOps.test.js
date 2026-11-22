// How far the person's own "+" goes for a persona, set and read through the wired handlers (ledger L977): the waist's
// param check included (one of 0..3), the write through its own collaborator (the key is reserved, so the property op
// refuses it), the read resolved by the collaborator (own, else the default persona's, else 3).
import { describe, it, expect } from 'vitest';
import { wireSkill } from '@onderling/sdk';
import { opWeight } from '@onderling/app-manifest';
import { agentsManifest } from '../manifest.js';
import { setPlusCeiling, getPlusCeiling } from '../src/cores.js';

const opOf = (id) => agentsManifest.operations.find((o) => o.id === id);
function wired() {
  const kept = {};
  const store = { registry: { list: async () => [] }, profiles: {
    setPlusCeiling: async ({ profileId, ceiling }) => { kept[profileId] = ceiling; return { ok: true }; },
    plusCeilingOf: async ({ profileId }) => kept[profileId] ?? 3,
  } };
  const set = wireSkill(setPlusCeiling, opOf('setPlusCeiling'), { storeFor: () => store });
  const get = wireSkill(getPlusCeiling, opOf('getPlusCeiling'), { storeFor: () => store });
  return { set, get, kept };
}
const call = (h, args) => h({ parts: [{ type: 'DataPart', data: args }] });

describe('the ceiling of the "+", through the waist', () => {
  it('sets one of the four and reads it back; 3 when nothing is set', async () => {
    const { set, get } = wired();
    expect((await call(get, { id: 'werk' })).ceiling).toBe(3);
    expect((await call(set, { id: 'werk', ceiling: 1 }))?.ok).toBe(true);
    expect((await call(get, { id: 'werk' })).ceiling).toBe(1);
    expect((await call(set, { id: 'werk', ceiling: 0 }))?.ok).toBe(true);
  });
  it('refuses a value that is not one of the four', async () => {
    const { set, kept } = wired();
    const r = await call(set, { id: 'werk', ceiling: 5 });
    expect(r?.ok).not.toBe(true);
    expect(kept.werk).toBeUndefined();
  });
  it('setting it weighs as the person\'s control, so the "+" never offers it; reading it is a read', () => {
    expect(opWeight(agentsManifest, opOf('setPlusCeiling'))).toBe(4);
    expect(opWeight(agentsManifest, opOf('getPlusCeiling'))).toBe(1);
    expect(opOf('setPlusCeiling').surfaces.chat).toBeUndefined();
  });
});
