import { describe, it, expect, vi } from 'vitest';
import {
  BLOCK_REGISTRY, materializeBlock, materializeRecipe,
} from '../../src/v2/circleRecipeBlocks.js';
import { addBlock, emptyRecipe } from '../../src/v2/circleRecipe.js';

function fakeEventLog(events = []) {
  return { query: () => events };
}

describe('circleRecipeBlocks · α.1b — registry', () => {
  it('lists every BLOCK_TYPES entry with metadata', () => {
    for (const t of ['announcement', 'noticeboard', 'agenda', 'rules', 'photo', 'text']) {
      expect(BLOCK_REGISTRY[t]).toMatchObject({
        labelKey: expect.stringMatching(/^circle\.recipe\.block\./),
        emoji:    expect.any(String),
        order:    expect.any(Number),
      });
    }
  });
});

describe('circleRecipeBlocks · α.1b — materializeBlock (pure types)', () => {
  it('announcement: ok when text present, empty when blank', async () => {
    const r1 = await materializeBlock({ block: { id: 'b', type: 'announcement', config: { text: 'Buurtfeest!' } } });
    // α.5c — announcement is list-shaped, so the materializer surfaces a
    // `config: { compact }` flag for the renderer; falsy by default.
    expect(r1).toEqual({
      blockId: 'b', type: 'announcement', status: 'ok',
      content: { text: 'Buurtfeest!' },
      config: { compact: false },
    });

    const r2 = await materializeBlock({ block: { id: 'b', type: 'announcement', config: { text: '   ' } } });
    expect(r2.status).toBe('empty');
    expect(r2.content.text).toBe('');
  });

  it('text block mirrors announcement shape', async () => {
    const r = await materializeBlock({ block: { id: 'b', type: 'text', config: { text: 'Hi' } } });
    expect(r).toEqual({ blockId: 'b', type: 'text', status: 'ok', content: { text: 'Hi' } });
  });

  it('photo: ok when src present, includes caption', async () => {
    const r = await materializeBlock({
      block: { id: 'b', type: 'photo', config: { src: '/x.jpg', caption: 'feest' } },
    });
    expect(r).toEqual({
      blockId: 'b', type: 'photo', status: 'ok', content: { src: '/x.jpg', caption: 'feest' },
    });

    const empty = await materializeBlock({ block: { id: 'b', type: 'photo', config: {} } });
    expect(empty.status).toBe('empty');
    expect(empty.content.src).toBe('');
  });

  it('unknown block type → status:"error"', async () => {
    const r = await materializeBlock({ block: { id: 'b', type: 'nonsense' } });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/unknown/);
  });

  it('missing block argument → status:"error"', async () => {
    const r = await materializeBlock({});
    expect(r.status).toBe('error');
  });

  it('noticeboard block pulls stoop listOpen (#16 — scherm shows the prikbord)', async () => {
    const callSkill = async (app, op) => (app === 'stoop' && op === 'listOpen'
      ? { items: [{ id: 'p1', text: 'wie heeft een boormachine?', addedBy: 'https://alice.example/me' }] }
      : null);
    const r = await materializeBlock({ block: { id: 'b', type: 'noticeboard' }, circleId: 'c1', hostOps: { callSkill } });
    expect(r.type).toBe('noticeboard');
    expect(r.status).toBe('ok');
    expect(r.content.items).toHaveLength(1);
    expect(r.content.items[0].event.payload.text).toContain('boormachine');
    // `actor` keeps the FULL webid now — the shortening was display-only and display moved into the
    // reveal-gated `senderLabel` stamp; the full id is what lets the roster stamp match.
    expect(r.content.items[0].actor).toBe('https://alice.example/me');
  });
});

describe('circleRecipeBlocks · α.1b — materializeBlock (data-fetching types)', () => {
  it('noticeboard: pulls circle stream from eventLog, capped to limit', async () => {
    const events = [
      { id: 'e3', ts: 300, app: 'household', type: 'chat-message',
        actor: 'webid:bob', payload: { circleId: 'g1', text: 'newest' } },
      { id: 'e2', ts: 200, app: 'household', type: 'chat-message',
        actor: 'webid:anne', payload: { circleId: 'g1', text: 'middle' } },
      { id: 'e1', ts: 100, app: 'household', type: 'chat-message',
        actor: 'webid:carla', payload: { circleId: 'g1', text: 'oldest' } },
      { id: 'eX', ts: 400, app: 'household', type: 'chat-message',
        actor: 'webid:other', payload: { circleId: 'g-other', text: 'wrong circle' } },
    ];
    const r = await materializeBlock({
      block:    { id: 'b', type: 'noticeboard', config: { limit: 2 } },
      circleId: 'g1',
      hostOps:  { eventLog: fakeEventLog(events), circles: [{ id: 'g1', name: 'Selwerd' }] },
    });
    expect(r.status).toBe('ok');
    expect(r.content.items).toHaveLength(2);
    expect(r.content.items[0].id).toBe('e3');     // newest first per buildCircleStream
    // Cross-circle row is filtered out.
    expect(r.content.items.every((it) => it.circleId === 'g1')).toBe(true);
  });

  it('noticeboard: empty when no events for this circle', async () => {
    const r = await materializeBlock({
      block:    { id: 'b', type: 'noticeboard', config: {} },
      circleId: 'g1',
      hostOps:  { eventLog: fakeEventLog([]), circles: [] },
    });
    expect(r.status).toBe('empty');
    expect(r.content.items).toEqual([]);
  });

  it('noticeboard: empty when no eventLog wired (graceful)', async () => {
    const r = await materializeBlock({
      block:    { id: 'b', type: 'noticeboard', config: {} },
      circleId: 'g1',
      hostOps:  {},
    });
    expect(r.status).toBe('empty');
  });

  it('agenda: calls calendar.listEvents with horizonDays, slices to limit', async () => {
    const callSkill = vi.fn(async () => ({ items: [
      { id: 'e1', label: 'lunch',  type: 'calendar-event', state: 'open' },
      { id: 'e2', label: 'dinner', type: 'calendar-event', state: 'open' },
      { id: 'e3', label: 'koffie', type: 'calendar-event', state: 'open' },
    ] }));
    const r = await materializeBlock({
      block: { id: 'b', type: 'agenda', config: { limit: 2, horizonDays: 7 } },
      hostOps: { callSkill },
    });
    expect(callSkill).toHaveBeenCalledWith('calendar', 'listEvents', { days: 7 });
    expect(r.status).toBe('ok');
    expect(r.content.items.map((i) => i.id)).toEqual(['e1', 'e2']);
  });

  it('agenda: empty when no events come back', async () => {
    const callSkill = vi.fn(async () => ({ items: [] }));
    const r = await materializeBlock({
      block: { id: 'b', type: 'agenda', config: {} },
      hostOps: { callSkill },
    });
    expect(r.status).toBe('empty');
  });

  it('agenda: empty (not error) when callSkill is missing', async () => {
    const r = await materializeBlock({
      block: { id: 'b', type: 'agenda', config: {} },
      hostOps: {},
    });
    expect(r.status).toBe('empty');
    expect(r.content.items).toEqual([]);
  });

  it('tasks: carries embeds[] + resolves them to live titles (circleId = circle id)', async () => {
    const callSkill = vi.fn(async (app, op, args) => {
      if (app === 'tasks' && op === 'listOpen') {
        return { items: [{ id: 't1', text: 'Fix the gate', assignee: 'webid:me',
          embeds: [{ type: 'calendar-event', ref: 'evt-1' }] }] };
      }
      if (app === 'calendar' && op === 'getEventSnapshot' && args.id === 'evt-1') {
        return { title: 'Repair visit' };
      }
      return { error: 'unexpected' };
    });
    const r = await materializeBlock({
      block: { id: 'b', type: 'tasks', config: { scope: 'all' } },
      circleId: 'g1',
      hostOps: { callSkill, myWebid: 'webid:me' },
    });
    const embeds = r.content.items[0].embeds;
    expect(embeds[0]).toEqual({ type: 'calendar-event', ref: 'evt-1', title: 'Repair visit' });
  });

  it('rules: pulls latest rules via getGroupRules, normalises doc', async () => {
    const callSkill = vi.fn(async () => ({
      rules: {
        id: 'item-1',
        source: { doc: {
          purpose:    'Een fijne buurt zijn',
          agreements: 'Geen herrie na 22u',
        } },
      },
    }));
    const r = await materializeBlock({
      block: { id: 'b', type: 'rules', config: {} },
      circleId: 'g1',
      hostOps: { callSkill },
    });
    expect(callSkill).toHaveBeenCalledWith('stoop', 'getGroupRules', { groupId: 'g1' });
    expect(r.status).toBe('ok');
    expect(r.content.doc.purpose).toBe('Een fijne buurt zijn');
    expect(r.content.doc.agreements).toBe('Geen herrie na 22u');
  });

  it('rules: empty when no doc returned + when no callSkill / circleId', async () => {
    const callSkill = vi.fn(async () => ({ rules: null }));
    const r1 = await materializeBlock({
      block: { id: 'b', type: 'rules', config: {} },
      circleId: 'g1',
      hostOps: { callSkill },
    });
    expect(r1.status).toBe('empty');

    const r2 = await materializeBlock({
      block: { id: 'b', type: 'rules', config: {} },
      hostOps: {},
    });
    expect(r2.status).toBe('empty');
  });
});

describe('circleRecipeBlocks · α.4 — tasks block (per-circle)', () => {
  it('calls tasks-v0.listOpen with circleId, filters by assignee=myWebid, caps to limit', async () => {
    const callSkill = vi.fn(async (app, op, args) => {
      expect(app).toBe('tasks');
      expect(op).toBe('listOpen');
      expect(args.circleId).toBe('g1');
      return { items: [
        { id: 't1', text: 'one', assignee: 'webid:me' },
        { id: 't2', text: 'two', assignee: 'webid:bob' },
        { id: 't3', text: 'three', assignee: 'webid:me' },
        { id: 't4', text: 'four', assignee: 'webid:me' },
      ] };
    });
    const r = await materializeBlock({
      block: { id: 'b', type: 'tasks', config: { scope: 'assigned-to-me', limit: 2 } },
      circleId: 'g1',
      hostOps: { callSkill, myWebid: 'webid:me' },
    });
    expect(r.status).toBe('ok');
    expect(r.content.items.map((t) => t.id)).toEqual(['t1', 't3']);
    expect(r.content.scope).toBe('assigned-to-me');
  });

  it('scope:"all" returns every open task regardless of assignee', async () => {
    const callSkill = vi.fn(async () => ({ items: [
      { id: 't1', text: 'one', assignee: 'webid:me' },
      { id: 't2', text: 'two' },   // unassigned
      { id: 't3', text: 'three', assignee: 'webid:bob' },
    ] }));
    const r = await materializeBlock({
      block: { id: 'b', type: 'tasks', config: { scope: 'all' } },
      circleId: 'g1',
      hostOps: { callSkill, myWebid: 'webid:me' },
    });
    expect(r.content.items.map((t) => t.id)).toEqual(['t1', 't2', 't3']);
  });

  it('assigned-to-me with no myWebid (dev mode) returns every assigned task', async () => {
    const callSkill = vi.fn(async () => ({ items: [
      { id: 't1', assignee: 'webid:a' },
      { id: 't2' },   // unassigned → excluded
      { id: 't3', assignee: 'webid:b' },
    ] }));
    const r = await materializeBlock({
      block: { id: 'b', type: 'tasks', config: {} },
      circleId: 'g1',
      hostOps: { callSkill },
    });
    expect(r.content.items.map((t) => t.id)).toEqual(['t1', 't3']);
  });

  it('empty when no callSkill or no circleId', async () => {
    const r1 = await materializeBlock({
      block: { id: 'b', type: 'tasks' }, circleId: 'g1', hostOps: {},
    });
    expect(r1.status).toBe('empty');
    const r2 = await materializeBlock({
      block: { id: 'b', type: 'tasks' }, hostOps: { callSkill: async () => ({ items: [] }) },
    });
    expect(r2.status).toBe('empty');
  });
});

describe('circleRecipeBlocks · α.1b — error tolerance', () => {
  it('materializeBlock catches per-type throws, returns status:"error"', async () => {
    const callSkill = vi.fn(async () => { throw new Error('calendar offline'); });
    const r = await materializeBlock({
      block: { id: 'b', type: 'agenda', config: {} },
      hostOps: { callSkill },
    });
    expect(r.status).toBe('error');
    expect(r.error).toMatch(/calendar offline/);
  });
});

describe('circleRecipeBlocks · D1 (§5A) — quickActions', () => {
  const block = { id: 'q', type: 'quickActions', config: { limit: 4 } };

  it('cold start: falls back to enabledFeatures order, source=default', async () => {
    // Default policy enables chat, noticeboard, houseRules, memberDirectory (CIRCLE_FEATURES order; S1 #1).
    const r = await materializeBlock({ block, circleId: 'c1', hostOps: { policy: null } });
    expect(r.type).toBe('quickActions');
    expect(r.status).toBe('ok');
    expect(r.content.source).toBe('default');
    expect(r.content.actions.map((a) => a.key)).toEqual(['chat', 'noticeboard', 'houseRules', 'memberDirectory']);
  });

  it('frequency reorders within the enabled set, source=frequency', async () => {
    const policy = { features: { chat: true, noticeboard: false, tasks: true, calendar: true, houseRules: true } };
    const actionFrequency = {
      top: () => ['calendar', 'tasks'],   // most-used first
    };
    const r = await materializeBlock({ block, circleId: 'c1', hostOps: { policy, actionFrequency } });
    expect(r.content.source).toBe('frequency');
    // calendar, tasks lead (by frequency); chat, houseRules follow in default order.
    expect(r.content.actions.map((a) => a.key)).toEqual(['calendar', 'tasks', 'chat', 'houseRules']);
  });

  it('never offers an action the circle has disabled, even if it has history', async () => {
    const policy = { features: { chat: true, tasks: false, houseRules: true, memberDirectory: true } };
    const actionFrequency = { top: () => ['tasks', 'chat'] }; // tasks is disabled now
    const r = await materializeBlock({ block, circleId: 'c1', hostOps: { policy, actionFrequency } });
    const keys = r.content.actions.map((a) => a.key);
    expect(keys).not.toContain('tasks');
    expect(keys[0]).toBe('chat'); // surviving frequency entry leads
  });

  it('honours the limit + clamps it (1..8, default 4)', async () => {
    const allOn = { features: Object.fromEntries(
      ['chat','noticeboard','tasks','lists','calendar','notes','houseRules','memberDirectory'].map((k) => [k, true])) };
    const r2 = await materializeBlock({ block: { id: 'q', type: 'quickActions', config: { limit: 2 } }, circleId: 'c1', hostOps: { policy: allOn } });
    expect(r2.content.actions).toHaveLength(2);
    const rDefault = await materializeBlock({ block: { id: 'q', type: 'quickActions', config: {} }, circleId: 'c1', hostOps: { policy: allOn } });
    expect(rDefault.content.actions).toHaveLength(4);
  });
});

describe('circleRecipeBlocks · α.1b — materializeRecipe', () => {
  it('materialises every block in order, preserving array shape', async () => {
    const recipe = addBlock(
      addBlock(
        addBlock(emptyRecipe(), 'announcement', { text: 'Hi' }),
        'text', { text: 'meer hier' }),
      'photo', { src: '/a.jpg' });
    const out = await materializeRecipe({ recipe, hostOps: {} });
    expect(out.map((b) => b.type)).toEqual(['announcement', 'text', 'photo']);
    expect(out.map((b) => b.status)).toEqual(['ok', 'ok', 'ok']);
  });

  it('returns empty array for an empty recipe', async () => {
    const out = await materializeRecipe({ recipe: emptyRecipe(), hostOps: {} });
    expect(out).toEqual([]);
  });

  it('returns empty array when recipe is missing / malformed', async () => {
    expect(await materializeRecipe({})).toEqual([]);
    expect(await materializeRecipe({ recipe: null })).toEqual([]);
    expect(await materializeRecipe({ recipe: { blocks: null } })).toEqual([]);
  });
});
