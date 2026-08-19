import { describe, it, expect, vi } from 'vitest';
import { materializeScreen } from '../../src/v2/userScreenBlocks.js';
import { emptyScreen, addCircleToScreen } from '../../src/v2/userScreens.js';
import { addBlock } from '../../src/v2/circleRecipe.js';

function fakeEventLog(events = []) {
  return { query: () => events };
}

const circles = [
  { id: 'g1', name: 'Selwerd' },
  { id: 'g2', name: 'Helpman' },
  { id: 'g3', name: 'Centrum' },
];

const events = [
  { id: 'e1', ts: 100, app: 'household', type: 'chat-message',
    actor: 'a', payload: { circleId: 'g1', text: 'oldest g1' } },
  { id: 'e2', ts: 200, app: 'household', type: 'chat-message',
    actor: 'a', payload: { circleId: 'g2', text: 'middle g2' } },
  { id: 'e3', ts: 300, app: 'household', type: 'chat-message',
    actor: 'a', payload: { circleId: 'g3', text: 'newest g3' } },
  { id: 'e4', ts: 400, app: 'household', type: 'chat-message',
    actor: 'a', payload: { circleId: 'g1', text: 'newer g1' } },
];

/* ─────────────────────────────────────────────────────────────────── */
/* Circle-agnostic blocks                                              */
/* ─────────────────────────────────────────────────────────────────── */

describe('materializeScreen · α.2.b — empty + agnostic blocks', () => {
  it('returns [] for missing/empty screen', async () => {
    expect(await materializeScreen({})).toEqual([]);
    expect(await materializeScreen({ screen: { blocks: [] } })).toEqual([]);
  });

  it('announcement/text/photo render unchanged from per-circle materializer', async () => {
    const screen = addBlock(addBlock(addBlock(
      emptyScreen('Stream'),
      'announcement', { text: 'Hi!' }),
      'text',          { text: 'meer' }),
      'photo',         { src: '/a.jpg', caption: 'feest' });
    const out = await materializeScreen({ screen, hostOps: { circles } });
    expect(out.map((b) => b.type)).toEqual(['announcement', 'text', 'photo']);
    expect(out.map((b) => b.status)).toEqual(['ok', 'ok', 'ok']);
    expect(out[0].content.text).toBe('Hi!');
    expect(out[2].content.src).toBe('/a.jpg');
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* noticeboard: cross-circle merge                                     */
/* ─────────────────────────────────────────────────────────────────── */

describe('materializeScreen · α.2.b — noticeboard (multi-circle)', () => {
  it('ALL_CIRCLES: merges every circle\'s stream rows, newest-first', async () => {
    const screen = addBlock(emptyScreen('Stream'), 'noticeboard', { limit: 10 });
    const out = await materializeScreen({
      screen,
      hostOps: { circles, eventLog: fakeEventLog(events) },
    });
    expect(out[0].status).toBe('ok');
    expect(out[0].content.items.map((r) => r.id)).toEqual(['e4', 'e3', 'e2', 'e1']);
  });

  it('respects limit', async () => {
    const screen = addBlock(emptyScreen('Stream'), 'noticeboard', { limit: 2 });
    const out = await materializeScreen({
      screen,
      hostOps: { circles, eventLog: fakeEventLog(events) },
    });
    expect(out[0].content.items.map((r) => r.id)).toEqual(['e4', 'e3']);
  });

  it('circleFilter narrows to the picked circles', async () => {
    let screen = addBlock(emptyScreen('Selwerd'), 'noticeboard', { limit: 10 });
    screen = addCircleToScreen(screen, 'g1');
    const out = await materializeScreen({
      screen,
      hostOps: { circles, eventLog: fakeEventLog(events) },
    });
    expect(out[0].content.items.map((r) => r.id)).toEqual(['e4', 'e1']);
  });

  it('Q5: muted circles drop entirely from the merge', async () => {
    const screen = addBlock(emptyScreen('Stream'), 'noticeboard', { limit: 10 });
    const out = await materializeScreen({
      screen,
      hostOps: { circles, eventLog: fakeEventLog(events) },
      mutedCircleIds: new Set(['g1']),
    });
    // g1's events (e1, e4) are gone — leaves e3, e2.
    expect(out[0].content.items.map((r) => r.id)).toEqual(['e3', 'e2']);
  });

  it('all-muted: noticeboard renders empty', async () => {
    const screen = addBlock(emptyScreen('Stream'), 'noticeboard', { limit: 10 });
    const out = await materializeScreen({
      screen,
      hostOps: { circles, eventLog: fakeEventLog(events) },
      mutedCircleIds: ['g1', 'g2', 'g3'],
    });
    expect(out[0].status).toBe('empty');
    expect(out[0].content.items).toEqual([]);
  });

  it('no eventLog wired → empty (graceful)', async () => {
    const screen = addBlock(emptyScreen('Stream'), 'noticeboard');
    const out = await materializeScreen({ screen, hostOps: { circles } });
    expect(out[0].status).toBe('empty');
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* agenda                                                             */
/* ─────────────────────────────────────────────────────────────────── */

describe('materializeScreen · α.2.b — agenda', () => {
  it('calls calendar.listEvents with horizonDays, slices to limit', async () => {
    const screen = addBlock(emptyScreen('Stream'), 'agenda', { limit: 2, horizonDays: 7 });
    const callSkill = vi.fn(async () => ({ items: [
      { id: 'a', label: 'one' },
      { id: 'b', label: 'two' },
      { id: 'c', label: 'three' },
    ] }));
    const out = await materializeScreen({
      screen,
      hostOps: { circles, callSkill },
    });
    expect(callSkill).toHaveBeenCalledWith('calendar', 'listEvents', { days: 7 });
    expect(out[0].content.items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('all-muted: agenda renders empty (no events fetched)', async () => {
    const screen = addBlock(emptyScreen('Stream'), 'agenda');
    const callSkill = vi.fn(async () => ({ items: [] }));
    const out = await materializeScreen({
      screen,
      hostOps: { circles, callSkill },
      mutedCircleIds: ['g1', 'g2', 'g3'],
    });
    expect(out[0].status).toBe('empty');
    expect(callSkill).not.toHaveBeenCalled();
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* rules                                                              */
/* ─────────────────────────────────────────────────────────────────── */

describe('materializeScreen · α.2.b — rules', () => {
  it('single-circle filter: pulls that circle\'s rules, no multiCircle flag', async () => {
    let screen = addBlock(emptyScreen('Selwerd'), 'rules');
    screen = addCircleToScreen(screen, 'g1');
    const callSkill = vi.fn(async () => ({
      rules: { source: { doc: { purpose: 'Circle zijn' } } },
    }));
    const out = await materializeScreen({
      screen,
      hostOps: { circles, callSkill },
    });
    expect(callSkill).toHaveBeenCalledWith('stoop', 'getGroupRules', { groupId: 'g1' });
    expect(out[0].status).toBe('ok');
    expect(out[0].content.doc.purpose).toBe('Circle zijn');
    expect(out[0].content.multiCircle).toBe(false);
    expect(out[0].content.shownCircleId).toBe('g1');
  });

  it('multi-circle (ALL with > 1 circle): pulls FIRST circle, multiCircle=true', async () => {
    const screen = addBlock(emptyScreen('Stream'), 'rules');
    const callSkill = vi.fn(async () => ({
      rules: { source: { doc: { purpose: 'Zomaar' } } },
    }));
    const out = await materializeScreen({
      screen,
      hostOps: { circles, callSkill },
    });
    expect(out[0].content.multiCircle).toBe(true);
    // First circle in the list is g1.
    expect(callSkill.mock.calls[0][2]).toEqual({ groupId: 'g1' });
  });

  it('empty rules doc: status empty', async () => {
    let screen = addBlock(emptyScreen('Selwerd'), 'rules');
    screen = addCircleToScreen(screen, 'g1');
    const callSkill = vi.fn(async () => ({ rules: null }));
    const out = await materializeScreen({
      screen,
      hostOps: { circles, callSkill },
    });
    expect(out[0].status).toBe('empty');
  });

  it('no circles / no callSkill: empty', async () => {
    const screen = addBlock(emptyScreen('Stream'), 'rules');
    const out = await materializeScreen({ screen, hostOps: { circles: [] } });
    expect(out[0].status).toBe('empty');
  });
});

/* ─────────────────────────────────────────────────────────────────── */
/* Error tolerance                                                    */
/* ─────────────────────────────────────────────────────────────────── */

describe('materializeScreen · α.4 — tasks block (multi-circle)', () => {
  it('ALL_CIRCLES: queries each circle and merges; assignee filter applies', async () => {
    const calls = [];
    const callSkill = vi.fn(async (app, op, args) => {
      calls.push([app, op, args]);
      if (args.circleId === 'g1') return { items: [
        { id: 't-g1-mine', text: 'g1 mine', assignee: 'webid:me', addedAt: 100 },
        { id: 't-g1-bob',  text: 'g1 bob',  assignee: 'webid:bob', addedAt: 200 },
      ] };
      if (args.circleId === 'g2') return { items: [
        { id: 't-g2-mine', text: 'g2 mine', assignee: 'webid:me', addedAt: 300 },
      ] };
      if (args.circleId === 'g3') return { items: [] };
      return { items: [] };
    });
    const screen = addBlock(emptyScreen('Mijn dingen'), 'tasks');
    const out = await materializeScreen({
      screen,
      hostOps: { callSkill, circles, myWebid: 'webid:me' },
    });
    // Only my tasks across g1+g2, newest first.
    expect(out[0].content.items.map((t) => t.id))
      .toEqual(['t-g2-mine', 't-g1-mine']);
    // Each task carries its circleId + circleName.
    expect(out[0].content.items[0].circleName).toBe('Helpman');
    expect(out[0].content.items[1].circleName).toBe('Selwerd');
    // Called once per circle.
    expect(calls.map((c) => c[2].circleId)).toEqual(['g1', 'g2', 'g3']);
  });

  it('Q5: muted circles drop entirely from the merge', async () => {
    const callSkill = vi.fn(async (app, op, args) => {
      if (args.circleId === 'g2') return { items: [
        { id: 't-g2', text: 'g2 mine', assignee: 'webid:me' },
      ] };
      return { items: [
        { id: `t-${args.circleId}-mine`, text: 'x', assignee: 'webid:me' },
      ] };
    });
    const screen = addBlock(emptyScreen('Stream'), 'tasks');
    const out = await materializeScreen({
      screen,
      hostOps: { callSkill, circles, myWebid: 'webid:me' },
      mutedCircleIds: ['g2'],
    });
    // g2 dropped → only g1 + g3 contribute.
    expect(out[0].content.items.map((t) => t.id).sort())
      .toEqual(['t-g1-mine', 't-g3-mine'].sort());
  });

  it('scope:"all" returns every open task across active circles', async () => {
    const callSkill = vi.fn(async (app, op, args) => ({ items: [
      { id: `${args.circleId}-a`, assignee: 'webid:me' },
      { id: `${args.circleId}-b` },  // unassigned
    ] }));
    let screen = addBlock(emptyScreen('Stream'), 'tasks', { scope: 'all' });
    const out = await materializeScreen({
      screen,
      hostOps: { callSkill, circles: [{ id: 'g1', name: 'G1' }], myWebid: 'webid:me' },
    });
    expect(out[0].content.items).toHaveLength(2);
  });

  it('all-muted: tasks renders empty without fetching', async () => {
    const callSkill = vi.fn(async () => ({ items: [] }));
    const screen = addBlock(emptyScreen('Stream'), 'tasks');
    const out = await materializeScreen({
      screen,
      hostOps: { callSkill, circles, myWebid: 'webid:me' },
      mutedCircleIds: ['g1', 'g2', 'g3'],
    });
    expect(out[0].status).toBe('empty');
    expect(callSkill).not.toHaveBeenCalled();
  });
});

describe('materializeScreen · α.2.b — error tolerance', () => {
  it('a per-type throw lands as status:"error" on that block; others succeed', async () => {
    const screen = addBlock(
      addBlock(emptyScreen('Stream'), 'agenda'),
      'text', { text: 'survives' });
    const callSkill = vi.fn(async () => { throw new Error('calendar down'); });
    const out = await materializeScreen({
      screen,
      hostOps: { circles, callSkill },
    });
    expect(out[0].status).toBe('error');
    expect(out[0].error).toMatch(/calendar down/);
    expect(out[1].status).toBe('ok');
  });
});
