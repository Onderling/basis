/**
 * THE CIRCLE'S LISTS, AS A BLOCK. Lists are the circle's own (`apps/lists`), so the circle screen shows them as a block
 * of its recipe, read through the lists' own ops (`listLists`, then `listEntries` per list) — no second read path.
 */
import { describe, it, expect, vi } from 'vitest';
import { materializeBlock } from '../../src/v2/circleRecipeBlocks.js';
import { BLOCK_DESCRIPTORS, blockTypesFor } from '../../src/v2/circleRecipe.js';
import { blockEmptyLine } from '../../src/v2/blockTitle.js';

describe('the lists block', () => {
  it('lives on the circle screen and on the person\'s pages (one circle\'s lists), listing the list noun', () => {
    expect(blockTypesFor('circle')).toContain('lists');
    expect(blockTypesFor('mij')).toContain('lists');
    expect(BLOCK_DESCRIPTORS.lists.noun).toBe('list');
    expect(BLOCK_DESCRIPTORS.lists.config()).toMatchObject({ circleId: null });
  });

  it('on a person\'s page it shows the circle its config names, with that circle\'s policy', async () => {
    const { materializeScreen } = await import('../../src/v2/userScreenBlocks.js');
    const callSkill = vi.fn(async (app, op, args) => (op === 'listLists' ? { ok: true, items: [{ id: 'l1', label: 'Boodschappen' }] } : { ok: true, title: 'Boodschappen', items: [] }));
    const getPolicy = vi.fn(async (cid) => ({ features: { lists: cid === 'thuis' } }));
    const screen = { id: 'p1', blocks: [{ id: 'b1', type: 'lists', config: { circleId: 'thuis' } }, { id: 'b2', type: 'lists', config: { circleId: 'werk' } }] };
    const [thuis, werk] = await materializeScreen({ screen, hostOps: { callSkill, getPolicy, circles: [{ id: 'thuis' }, { id: 'werk' }] } });
    expect(thuis.content.lists.map((l) => l.title)).toEqual(['Boodschappen']);
    expect(callSkill).toHaveBeenCalledWith('lists', 'listLists', { circleId: 'thuis' });
    expect(werk.content.off, "werk has lists off: the block says so").toBe(true);
  });

  it('shows each list with its open entries, through listLists and listEntries', async () => {
    const callSkill = vi.fn(async (app, op, args) => {
      if (op === 'listLists') return { ok: true, items: [{ id: 'l1', label: 'Boodschappen' }, { id: 'l2', label: 'Klusjes' }] };
      if (op === 'listEntries') return args.list === 'l1'
        ? { ok: true, title: 'Boodschappen', items: [{ id: 'e1', label: 'melk', type: 'list-item' }, { id: 'e2', label: 'brood', type: 'list-item' }] }
        : { ok: true, title: 'Klusjes', items: [] };
      return null;
    });
    const r = await materializeBlock({ block: { id: 'b1', type: 'lists', config: { limit: 5 } }, circleId: 'k1', hostOps: { callSkill } });
    expect(r.status).toBe('ok');
    const tick = (id) => ({ kind: 'op', app: 'lists', opId: 'markListItemDone', args: { circleId: 'k1', item: id, list: 'l1' }, labelKey: 'circle.vandaag.act_done' });
    expect(r.content.lists).toEqual([
      { id: 'l1', title: 'Boodschappen', entries: [{ id: 'e1', label: 'melk', done: false, primary: tick('e1') }, { id: 'e2', label: 'brood', done: false, primary: tick('e2') }] },
      { id: 'l2', title: 'Klusjes', entries: [] },
    ]);
    expect(callSkill).toHaveBeenCalledWith('lists', 'listLists', { circleId: 'k1' });
    expect(callSkill).toHaveBeenCalledWith('lists', 'listEntries', { circleId: 'k1', list: 'l1' });
  });

  it('a circle with no lists is empty, not an error; a failing read says so', async () => {
    const none = await materializeBlock({ block: { id: 'b', type: 'lists', config: {} }, circleId: 'k1', hostOps: { callSkill: async () => ({ ok: true, items: [] }) } });
    expect(none.status).toBe('empty');
    const failing = await materializeBlock({ block: { id: 'b', type: 'lists', config: {} }, circleId: 'k1', hostOps: { callSkill: async () => ({ ok: false, error: 'nope' }) } });
    expect(failing.status).toBe('empty');
  });

  it('the palette offers it only where the circle has lists on; switched off, a block still on the screen says so', async () => {
    expect(blockTypesFor('circle', { policy: { features: { lists: false } } })).not.toContain('lists');
    expect(blockTypesFor('circle', { policy: { features: { lists: true } } })).toContain('lists');
    const callSkill = vi.fn();
    const off = await materializeBlock({ block: { id: 'b', type: 'lists', config: {} }, circleId: 'k1', hostOps: { callSkill, policy: { features: { lists: false } } } });
    expect(off.content.off).toBe(true);
    expect(callSkill).not.toHaveBeenCalled();
    expect(blockEmptyLine(off, (k) => k)).toBe('circle.screen.lists_off');
  });

  it("the '+' counts a lists block for this circle on any of the person's pages", async () => {
    const { blockTypesShowingCircle } = await import('../../src/v2/userScreens.js');
    const book = { screens: [{ id: 'p1', blocks: [{ type: 'lists', config: { circleId: 'thuis' } }, { type: 'notes', config: {} }] }, { id: 'p2', blocks: [] }] };
    expect(blockTypesShowingCircle(book, 'thuis')).toEqual(['lists']);
    expect(blockTypesShowingCircle(book, 'werk')).toEqual([]);
  });
});
