// @vitest-environment happy-dom
/**
 * "Pas aan": the customise sheet's model (shared by both shells) and its acts, each one a screen op — driven here
 * through the real ops over a book, and through the web painter's controls.
 */
import { describe, it, expect, vi } from 'vitest';
import { createObjectVersionsAdapter } from '@onderling/kring-host/objectVersionsStorage';
import { createMemoryBackend } from '@onderling/pseudo-pod';
import { createUserScreenStore, getActiveScreen } from '../../src/v2/userScreens.js';
import { createScreenOps } from '../../src/v2/screenOps.js';
import { ensureVandaagBook, customiseModel, customiseOp, expandedPage, EXPANDED_LIMIT } from '../../src/v2/vandaag.js';
import { EventLog } from '../../src/eventLog.js';
import { renderVandaagCustomise } from '../../web/v2/vandaagCustomise.js';

const t = (k) => k;
let clock = 1;
const world = async () => {
  let book = null;
  const store = createUserScreenStore({
    io: { load: async () => book, save: async (b) => { book = b; } },
    versions: createObjectVersionsAdapter({ storeName: 'screens', backend: createMemoryBackend(), now: () => (clock += 10) }),
  });
  await ensureVandaagBook({ store, t });
  const ops = createScreenOps({ store, log: new EventLog({ initial: [], muted: [] }), actor: 'me' });
  const act = async (a, args) => { const { opId, args: opArgs } = customiseOp(a, args); return ops[opId](opArgs); };
  return { store, act };
};

describe('Pas aan', () => {
  it('the model lists the page\'s blocks with their controls, and what may be added (the person\'s pages only)', async () => {
    const { store } = await world();
    const m = customiseModel(await store.get());
    expect(m.blocks.map((b) => b.type)).toEqual(['calendar', 'tasks', 'circlesUnread']);
    expect(m.blocks[0].controls.map((c) => c.kind)).toEqual(['horizonDays', 'limit']);
    expect(m.blocks[1].controls.map((c) => c.kind)).toEqual(['scope', 'limit', 'withinDays']);
    expect(m.blocks[0].canUp).toBe(false);
    expect(m.addable.map((a) => a.type)).not.toContain('rules');
    expect(m.addable.every((a) => a.descriptionKey.startsWith('circle.recipe.block_desc.'))).toBe(true);
    expect(m.canRemovePage).toBe(false);
  });

  it('every act is a screen op: move, configure, add, remove, page acts, undo', async () => {
    const { store, act } = await world();
    let m = customiseModel(await store.get());
    const base = { pageId: m.pageId };
    await act('down', { ...base, blockId: m.blocks[0].blockId, index: 0 });
    expect(getActiveScreen(await store.get()).blocks.map((b) => b.type)).toEqual(['tasks', 'calendar', 'circlesUnread']);
    m = customiseModel(await store.get());
    await act('config', { ...base, blockId: m.blocks[1].blockId, kind: 'horizonDays', value: 30 });
    expect(getActiveScreen(await store.get()).blocks[1].config.horizonDays).toBe(30);
    await act('add', { ...base, type: 'text' });
    expect(getActiveScreen(await store.get()).blocks.map((b) => b.type)).toContain('text');
    await act('rename-page', { ...base, name: 'Mijn dag' });
    expect(getActiveScreen(await store.get()).name).toBe('Mijn dag');
    await act('undo', {});
    expect(getActiveScreen(await store.get()).name).not.toBe('Mijn dag');
    await act('add-page', { name: 'Werk' });
    expect((await store.get()).screens).toHaveLength(2);
  });

  it('the filters: a block narrows to some of the page\'s circles, labels only where the type carries them, a relative date', async () => {
    const { store, act } = await world();
    const circles = [{ id: 'a', name: 'Thuis' }, { id: 'b', name: 'Werk' }];
    let m = customiseModel(await store.get(), { circles });
    expect(m.blocks[0].controls.find((c) => c.kind === 'circleIds')?.options.map((o) => o.value)).toEqual(['a', 'b']);
    expect(m.blocks.some((b) => b.controls.some((c) => c.kind === 'labels')), 'no block on the first page carries labels').toBe(false);
    await act('add', { pageId: m.pageId, type: 'notes' });
    m = customiseModel(await store.get(), { circles });
    const notes = m.blocks.find((b) => b.type === 'notes');
    expect(notes.controls.map((c) => c.kind)).toEqual(['limit', 'circleIds', 'labels', 'withinDays']);
    await act('config', { pageId: m.pageId, blockId: notes.blockId, kind: 'labels', value: 'Werk, thuis ,werk' });
    await act('config', { pageId: m.pageId, blockId: notes.blockId, kind: 'circleIds', value: ['b'] });
    const cfg = getActiveScreen(await store.get()).blocks.find((b) => b.type === 'notes').config;
    expect(cfg.labels).toEqual(['werk', 'thuis']);
    expect(cfg.circleIds).toEqual(['b']);
    // one circle on the page: nothing to narrow to
    expect(customiseModel(await store.get(), { circles: [circles[0]] }).blocks[0].controls.some((c) => c.kind === 'circleIds')).toBe(false);
  });

  it('"meer" opens one block whole: that block only, its cap lifted', async () => {
    const { store } = await world();
    const page = getActiveScreen(await store.get());
    const whole = expandedPage(page, page.blocks[1].id);
    expect(whole.blocks).toHaveLength(1);
    expect(whole.blocks[0].config.limit).toBe(EXPANDED_LIMIT);
    expect(expandedPage(page, 'nope')).toBe(null);
  });

  it('the web sheet reports each control as its act', async () => {
    const { store } = await world();
    const onAct = vi.fn();
    const el = renderVandaagCustomise(document.createElement('div'), { model: customiseModel(await store.get()), t, onAct, onClose: () => {} });
    el.querySelector('[data-act="down"]').click();
    expect(onAct).toHaveBeenLastCalledWith('down', expect.objectContaining({ index: 0 }));
    const sel = el.querySelector('select[data-control="horizonDays"]');
    sel.value = '30'; sel.dispatchEvent(new Event('change'));
    expect(onAct).toHaveBeenLastCalledWith('config', expect.objectContaining({ kind: 'horizonDays', value: 30 }));
    el.querySelector('[data-act="undo"]').click();
    expect(onAct).toHaveBeenLastCalledWith('undo', {});
  });
});

describe('the web sheet\'s filters', () => {
  it('circles as ticks, labels as text — each reported as its act', async () => {
    let book = null;
    const store = createUserScreenStore({ io: { load: async () => book, save: async (b) => { book = b; } } });
    await ensureVandaagBook({ store, t });
    const model = customiseModel(await store.get(), { circles: [{ id: 'a', name: 'Thuis' }, { id: 'b', name: 'Werk' }] });
    model.blocks.push({ blockId: 'n', type: 'notes', labelKey: 'x', index: 3, canUp: true, canDown: false, controls: [{ kind: 'labels', text: true, value: '' }] });
    const onAct = vi.fn();
    const el = renderVandaagCustomise(document.createElement('div'), { model, t, onAct, onClose: () => {} });
    const tick = el.querySelector('[data-control="circleIds"] input[value="b"]');
    tick.checked = true; tick.dispatchEvent(new Event('change'));
    expect(onAct).toHaveBeenLastCalledWith('config', expect.objectContaining({ kind: 'circleIds', value: ['b'] }));
    const labels = el.querySelector('input[data-control="labels"]');
    labels.value = 'werk'; labels.dispatchEvent(new Event('change'));
    expect(onAct).toHaveBeenLastCalledWith('config', expect.objectContaining({ kind: 'labels', value: 'werk' }));
  });
});
