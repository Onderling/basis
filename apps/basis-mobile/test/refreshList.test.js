/**
 * refreshList — step 3 (state-morphing list bubbles).
 *
 * The contract: given the dispatch that produced an original list
 * bubble, calling refreshList re-runs it and returns a NEW
 * RenderedReply.  The shell's messages-state reducer then mutates
 * the original bubble's `rendered` field, so the row buttons
 * re-evaluate against the post-tap state.
 *
 * Tests use a mock callSkill that maintains a small in-memory store
 * of chores + flips their state on markComplete.  This keeps the
 * test fast (no real agent boot) and pins the behaviour we care
 * about: row buttons re-light after a state-changing tap.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
  refreshList, snapshotSourceDispatch,
} from '../src/core/refreshList.js';

import { composeManifests, buildManifestsByOrigin } from '../src/core/composeManifests.js';
import { renderReply, runDispatch, resolveDispatch, parseInput } from '@onderling-app/basis';
import { initLocalisation, t } from '../src/core/localisation.js';
import { setDevLog } from '../src/core/devLog.js';

beforeAll(async () => {
  await initLocalisation({ lang: 'en' });
  setDevLog(false);                  // tests shouldn't spam stdout
});

/** Mock-bundle factory: minimal household-like store with listOpen + markComplete.
 *  Part G (2026-06-17) — items use a REAL household list type ('shopping') so the
 *  REAL manifest's markComplete `appliesTo: {type: [...LIST_TYPES, 'task']}` gate
 *  lights the per-row [Done] button; markComplete resolves by `match` (id). */
function makeMockBundle() {
  const chores = new Map();   // id → { id, type:'shopping', title, state }
  chores.set('c1', { id: 'c1', type: 'shopping', title: 'Milk',           state: 'open' });
  chores.set('c2', { id: 'c2', type: 'shopping', title: 'Bread',          state: 'open' });
  chores.set('c3', { id: 'c3', type: 'shopping', title: 'Apples',         state: 'open' });

  const catalogue           = composeManifests();
  const manifestsByOrigin = buildManifestsByOrigin();

  const callSkill = async (appOrigin, opId, args = {}) => {
    if (appOrigin !== 'household') {
      throw new Error(`mock callSkill only knows household; got ${appOrigin}`);
    }
    if (opId === 'listOpen') {
      const items = [...chores.values()].filter((c) => c.state === 'open');
      return { items };
    }
    if (opId === 'markComplete') {
      // Real household markComplete binds the row id to `match`.
      const c = chores.get(args.match ?? args.choreId);
      if (!c) return { ok: false, error: `unknown item: ${args.match}` };
      c.state = 'completed';
      return { ok: true };
    }
    throw new Error(`mock callSkill: unknown op ${opId}`);
  };

  return { catalogue, manifestsByOrigin, callSkill, chores };
}

describe('#253 step 3 — refreshList state morphing', () => {
  it('initial render of /list shopping has all 3 open items with buttons', async () => {
    const { catalogue, manifestsByOrigin, callSkill } = makeMockBundle();
    const parsed   = parseInput('/list shopping', catalogue);
    const dispatch = resolveDispatch(parsed, catalogue);
    expect(dispatch.kind).toBe('ready');
    const reply    = await runDispatch(dispatch, callSkill);
    const rendered = renderReply(reply, {
      t, appOrigin: dispatch.appOrigin, manifestsByOrigin,
    });
    expect(rendered.kind).toBe('list');
    expect(rendered.items).toHaveLength(3);
    const totalButtons = rendered.items.reduce((n, it) => n + (it.buttons?.length ?? 0), 0);
    expect(totalButtons).toBeGreaterThan(0);
  });

  it('refreshList re-runs the source dispatch and drops the completed chore', async () => {
    const bundle = makeMockBundle();
    const { catalogue, manifestsByOrigin, callSkill, chores } = bundle;

    // Snapshot the source dispatch (the listOpen the bubble came from).
    const sourceDispatch = snapshotSourceDispatch({
      opId:       'listOpen',
      args:       {},
      appOrigin:  'household',
      replyShape: 'list',
    });

    // Initial: 3 items.
    const before = await refreshList({ ...bundle, sourceDispatch, t });
    expect(before.items).toHaveLength(3);

    // Simulate the side-effect of a row-tap dispatch (real markComplete `match`).
    await callSkill('household', 'markComplete', { match: 'c2' });

    // After refresh: 2 items (c2 is now state:'completed' and listOpen filters it out).
    const after = await refreshList({ ...bundle, sourceDispatch, t });
    expect(after.items).toHaveLength(2);
    expect(after.items.map((i) => i.id)).toEqual(['c1', 'c3']);
    // The remaining rows STILL have buttons (state is still 'open').
    const remainingButtons = after.items.reduce((n, it) => n + (it.buttons?.length ?? 0), 0);
    expect(remainingButtons).toBeGreaterThan(0);

    // Store didn't get mutated weirdly.
    expect(chores.get('c2').state).toBe('completed');
    expect(chores.get('c1').state).toBe('open');
  });

  it('refreshList returns null when sourceDispatch is not ready', async () => {
    const bundle = makeMockBundle();
    const r1 = await refreshList({ ...bundle, sourceDispatch: null, t });
    expect(r1).toBeNull();
    const r2 = await refreshList({
      ...bundle,
      sourceDispatch: { kind: 'unknown' },
      t,
    });
    expect(r2).toBeNull();
  });

  it('refreshList returns null when the op is not in the catalogue', async () => {
    const bundle = makeMockBundle();
    const r = await refreshList({
      ...bundle,
      sourceDispatch: {
        kind:      'ready',
        opId:      'doesNotExistInCatalogue',
        args:      {},
        appOrigin: 'household',
      },
      t,
    });
    expect(r).toBeNull();
  });

  it('refreshList swallows callSkill errors and returns null (UI keeps bubble as-is)', async () => {
    const bundle = makeMockBundle();
    const sourceDispatch = snapshotSourceDispatch({
      opId: 'listOpen', args: {}, appOrigin: 'household', replyShape: 'list',
    });
    const broken = { ...bundle, callSkill: async () => { throw new Error('boom'); } };
    const r = await refreshList({ ...broken, sourceDispatch, t });
    expect(r).toBeNull();
  });
});
