/**
 * A read the model picks is LOOKED AT (not shown) and handed back to it once, so the turn can act on it — the
 * read-then-act step. Every shell composes it the same way: resolve the op, gate it as the shell gates any
 * dispatch, run it through the shell's call, paint nothing. A read that is not ready, or that the gate refuses,
 * is not looked at.
 */
import { describe, it, expect } from 'vitest';
import { createPeek } from '../../src/v2/circlePeek.js';
import { mergeManifests } from '../../src/manifestMerge.js';
import { listsManifest } from '../../../lists/manifest.js';

const catalogue = mergeManifests([{ manifest: listsManifest }]);

describe('the read-then-act peek', () => {
  it('runs a ready read through the shell\'s call and returns what it answered', async () => {
    const ran = [];
    const peek = createPeek({ catalogue: () => catalogue, run: async (ready) => { ran.push(ready.opId); return { ok: true, items: [{ id: 'i1', label: 'melk' }] }; } });
    expect(await peek({ opId: 'listEntries', args: { list: 'Boodschappen' } })).toMatchObject({ ok: true, items: [{ label: 'melk' }] });
    expect(ran).toEqual(['listEntries']);
  });

  it('a refused or unready op is not looked at', async () => {
    const ran = [];
    const run = async (ready) => { ran.push(ready.opId); return { ok: true }; };
    expect(await createPeek({ catalogue: () => catalogue, run, deny: async () => 'app-disabled' })({ opId: 'listEntries', args: { list: 'x' } })).toBeNull();
    expect(await createPeek({ catalogue: () => catalogue, run })({ opId: 'listEntries', args: {} })).toBeNull();   // needs a list
    expect(await createPeek({ catalogue: () => catalogue, run })({ opId: 'noSuchOp', args: {} })).toBeNull();
    expect(ran).toEqual([]);
  });
});
