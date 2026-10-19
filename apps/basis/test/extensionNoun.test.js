/**
 * A THIRD-PARTY data type, end to end on one node: booted with the example extension, a plant is added and listed in a
 * circle through the free atoms (no handler, no store of its own — the circle's one store holds it); a node WITHOUT the
 * extension refuses the type, and an extension that breaks the compose rules brings nothing.
 */
import { describe, it, expect } from 'vitest';
import { encodeGenericOpId } from '@onderling/app-manifest';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { PERSON_NODE_STORE_OPTS } from '../src/v2/personNodeStore.js';
import { plantsManifest } from '../../example-plants/manifest.js';

const op = (atom) => encodeGenericOpId('plants', atom, 'plants.plant');
const boot = (extensions) => createRealHouseholdAgent({ seedHousehold: false, ...PERSON_NODE_STORE_OPTS, ...(extensions ? { extensions } : {}) });

describe('a third-party noun on a node', () => {
  it('with the extension: added and listed in a circle, its schema holding', async () => {
    const a = await boot([{ origin: 'plants', manifest: plantsManifest }]);
    const made = await a.callSkill('plants', op('add'), { circleId: 'huis', body: 'Monstera', room: 'kamer', waterAt: '2026-10-20T08:00:00.000Z' });
    expect(made?.ok, JSON.stringify(made)).not.toBe(false);
    const listed = await a.callSkill('plants', op('list'), { circleId: 'huis' });
    const rows = (listed?.result?.items ?? listed?.items ?? []).filter((r) => r.type === 'plants.plant');
    expect(rows.map((r) => r.body)).toEqual(['Monstera']);
    // the store's registry holds the type: a plant without a name is refused
    const bad = await a.callSkill('plants', op('add'), { circleId: 'huis', body: 'Ficus', waterAt: 12 });
    expect(bad?.ok, 'waterAt is a string in its schema').toBe(false);
  });

  it('without it: the type is unknown, the ops unreachable', async () => {
    const b = await boot(null);
    const r = await b.callSkill('plants', op('add'), { circleId: 'huis', body: 'Monstera' });
    expect(r?.ok).toBe(false);
  });

  it('an extension breaking the compose rules brings nothing (here: a noun outside its origin)', async () => {
    const rogue = { ...plantsManifest, nouns: { note: plantsManifest.nouns['plants.plant'] } };
    const c = await boot([{ origin: 'plants', manifest: rogue }]);
    const r = await c.callSkill('plants', encodeGenericOpId('plants', 'add', 'note'), { circleId: 'huis', body: 'x' });
    expect(r?.ok).toBe(false);
  });
});
