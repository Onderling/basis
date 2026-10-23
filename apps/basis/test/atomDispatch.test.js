/**
 * Atom-dispatch fitness function (B · Layer 1, PLAN §1b seam).
 *
 * `dispatchAtom(manifest, {atom, noun}, dispatch)` is the seam that lets a caller invoke a capability by
 * its ATOM + NOUN (the stable vocabulary) instead of the bespoke op-id. This proves it stays consistent
 * with the capability surface across every REAL manifest: for each `(atom × noun)` the manifest exposes,
 * dispatchAtom must resolve to EXACTLY the op-id `capabilitiesOf` names (or report `unimplemented` for a
 * declared-but-unimplemented pair). Fails CI if a declared capability stops being atom-dispatchable —
 * e.g. a noun/atom is declared (via #81's `nouns`) with no implementing op, or resolveAtom drifts.
 */
import { describe, it, expect, vi } from 'vitest';
import { capabilitiesOf, dispatchAtom, dispatchCapability } from '@onderling/app-manifest';
import { CircleItemStore, memoryDataSource, createGenericAtomHandlers } from '@onderling/item-store';

import { householdManifest }  from '../../household/manifest.js';
import { calendarManifest }   from '../../calendar/manifest.js';
import { tasksManifest }      from '../../tasks-v0/manifest.js';
import { folioManifest }      from '../../folio/manifest.js';
import { pinboardManifest }      from '../../pinboard/manifest.js';
import { agentsManifest }     from '../../agents/manifest.js';
import { basisManifest } from '../manifest.js';

const MANIFESTS = [
  ['household',   householdManifest],
  ['calendar',    calendarManifest],
  ['tasks-v0',    tasksManifest],
  ['folio',       folioManifest],
  ['pinboard',       pinboardManifest],
  ['agents',      agentsManifest],
  ['basis', basisManifest],
];

describe('atom-dispatch consistency (B · Layer 1 §1b)', () => {
  for (const [name, manifest] of MANIFESTS) {
    const caps = capabilitiesOf(manifest);

    it(`${name}: every capability is atom-dispatchable to the op it names`, async () => {
      const mismatches = [];
      for (const cap of caps) {
        const spy = vi.fn(async (opId) => opId);
        const r = await dispatchAtom(manifest, { atom: cap.atom, noun: cap.noun }, spy);
        if (typeof cap.opId === 'string') {
          // implemented → dispatchAtom resolves to that exact op + invokes it
          if (!(r.ok && r.opId === cap.opId && spy.mock.calls[0]?.[0] === cap.opId)) {
            mismatches.push(`${cap.atom}·${cap.noun} → expected ${cap.opId}, got ${JSON.stringify(r)}`);
          }
        } else {
          // declared-but-unimplemented → reported, not dispatched
          if (!(r.ok === false && r.code === 'unimplemented')) {
            mismatches.push(`${cap.atom}·${cap.noun} → expected unimplemented, got ${JSON.stringify(r)}`);
          }
        }
      }
      expect(mismatches, mismatches.join('\n')).toEqual([]);
    });
  }

  it('canonicalises an alias atom to the same op as its canonical form', async () => {
    // household: create→add, shopping noun → the add op for shopping
    const spy = vi.fn(async (opId) => opId);
    const viaAlias = await dispatchAtom(householdManifest, { atom: 'create', noun: 'shopping' }, spy);
    const viaCanon = await dispatchAtom(householdManifest, { atom: 'add', noun: 'shopping' }, spy);
    expect(viaAlias.ok && viaAlias.opId).toBe(viaCanon.opId);
  });
});

/**
 * End-to-end §1b: "declare a noun → get CRUD free". The two halves — app-manifest's `dispatchCapability`
 * (routing) + item-store's `createGenericAtomHandlers` (a store-backed generic CRUD) — meet here, the one
 * place that depends on both. A manifest that DECLARES a noun with the CRUD atoms but ships NO ops for them
 * becomes fully operable through the standard verb vocabulary, over a real CircleItemStore.
 */
describe('declare a noun → get CRUD free (dispatchCapability × generic handlers × real store)', () => {
  // A minimal app manifest: `widget` declares the five CRUD atoms; `note` ships a bespoke add op.
  const appManifest = {
    app: 'gadgets',
    itemTypes: ['widget', 'note'],
    nouns: {
      widget: { atoms: ['add', 'list', 'get', 'update', 'remove'] },
      note:   { atoms: ['add'] },
    },
    operations: [{ id: 'addNote', verb: 'add', appliesTo: { type: 'note' } }],
  };

  const mkDeps = () => {
    const store = new CircleItemStore({
      dataSource: memoryDataSource(), rootContainer: 'mem://gadgets/',
      registry: { validate: () => ({ ok: true }) },
    });
    const generic = createGenericAtomHandlers(store);
    const dispatch = vi.fn(async (opId, args) => ({ ranOp: opId, args }));
    return { store, generic, dispatch };
  };

  it('a declared-but-unimplemented noun round-trips add→list→get→update→remove via the generic handlers', async () => {
    const { generic, dispatch } = mkDeps();
    const cap = (atom, args) => dispatchCapability(appManifest, { atom, noun: 'widget', args }, { dispatch, generic, ctx: { by: 'webid:me' } });

    const added = await cap('add', { label: 'sprocket' });
    expect(added).toMatchObject({ ok: true, via: 'generic', atom: 'add' });
    const id = added.result.item.id;
    expect(id).toBeTruthy();

    expect((await cap('list')).result.items.map((i) => i.id)).toContain(id);
    expect((await cap('get', { id })).result.item.label).toBe('sprocket');
    expect((await cap('update', { id, label: 'cog' })).result.item).toMatchObject({ label: 'cog', updatedBy: 'webid:me' });
    expect(await (await cap('remove', { id })).result).toEqual({ ok: true, id });
    expect((await cap('get', { id })).result.ok).toBe(false);

    expect(dispatch).not.toHaveBeenCalled(); // never touched the bespoke-op path
  });

  it('a bespoke op still wins over the generic handler for the same atom', async () => {
    const { generic, dispatch } = mkDeps();
    const r = await dispatchCapability(appManifest, { atom: 'add', noun: 'note', args: { text: 'hi' } }, { dispatch, generic });
    expect(r).toMatchObject({ ok: true, via: 'op', opId: 'addNote' });
    expect(dispatch).toHaveBeenCalledWith('addNote', { text: 'hi' });
  });

  it('an undeclared (atom×noun) is unimplemented — the manifest stays authoritative', async () => {
    const { generic, dispatch } = mkDeps();
    expect(await dispatchCapability(appManifest, { atom: 'list', noun: 'note' }, { dispatch, generic }))
      .toMatchObject({ ok: false, code: 'unimplemented' });   // note declares only `add`
    expect(await dispatchCapability(appManifest, { atom: 'add', noun: 'ghost' }, { dispatch, generic }))
      .toMatchObject({ ok: false, code: 'unimplemented' });   // ghost isn't a noun
  });
});
