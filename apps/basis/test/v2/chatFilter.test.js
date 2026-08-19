/**
 * The viewer's chat filter — two axes, a ceiling, and the guarantees that keep it from eating the
 * conversation.
 *
 * Frits' case is the author axis: an automated agents' chat you don't want to read. No kind filter can
 * express it (the rows are the same kind), which is why `authors` exists alongside `kinds`.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CHAT_FILTER, CHAT_AUTHORS, normalizeChatFilter, applyChatFilter, chatFilterChips,
  localStorageChatFilterIo,
} from '../../src/v2/chatFilter.js';

const ALLOWED = ['chat-message', 'task', 'ask'];
const row = (type, actor, id) => ({ id, type, actor, event: { type, actor } });
const ROWS = [
  row('chat-message', 'anna', 'm1'),
  row('chat-message', 'bot-x', 'm2'),
  row('task',         'anna', 't1'),
  row('ask',        'bot-x', 'v1'),
];
const isAgentActor = (actor) => String(actor ?? '').startsWith('bot-');

describe('the default shows everything the circle allows', () => {
  it('an absent/garbage filter is the permissive default', () => {
    for (const junk of [undefined, null, 'nope', 42, { kinds: 'x', authors: 'zzz' }]) {
      expect(normalizeChatFilter(junk, ALLOWED)).toEqual(DEFAULT_CHAT_FILTER);
    }
    expect(applyChatFilter({ rows: ROWS, allowedKinds: ALLOWED, isAgentActor })).toHaveLength(4);
  });
});

describe("the author axis — Frits' case: an automated agents' chat", () => {
  it("'people' hides agent rows across every kind", () => {
    const out = applyChatFilter({
      rows: ROWS, filter: { authors: 'people' }, allowedKinds: ALLOWED, isAgentActor,
    });
    expect(out.map((r) => r.id)).toEqual(['m1', 't1']);
  });

  it("'agents' shows only them — auditing what the bots said is the same control, inverted", () => {
    const out = applyChatFilter({
      rows: ROWS, filter: { authors: 'agents' }, allowedKinds: ALLOWED, isAgentActor,
    });
    expect(out.map((r) => r.id)).toEqual(['m2', 'v1']);
  });

  it('with no isAgentActor injected the axis is a NO-OP, never a blank conversation', () => {
    // The host owns the roster; if it wires nothing, "hide agents" must not hide people.
    const out = applyChatFilter({ rows: ROWS, filter: { authors: 'people' }, allowedKinds: ALLOWED });
    expect(out).toHaveLength(4);
  });

  it('a throwing isAgentActor is treated as "not an agent", not as an error', () => {
    const out = applyChatFilter({
      rows: ROWS, filter: { authors: 'people' }, allowedKinds: ALLOWED,
      isAgentActor: () => { throw new Error('roster exploded'); },
    });
    expect(out).toHaveLength(4);
  });
});

describe('the kind axis — chat itself is filterable', () => {
  it('chat-message can be filtered OUT like any other kind', () => {
    const out = applyChatFilter({
      rows: ROWS, filter: { kinds: ['task', 'ask'] }, allowedKinds: ALLOWED, isAgentActor,
    });
    expect(out.map((r) => r.id)).toEqual(['t1', 'v1']);
  });

  it('the two axes compose', () => {
    const out = applyChatFilter({
      rows: ROWS, filter: { kinds: ['chat-message'], authors: 'people' },
      allowedKinds: ALLOWED, isAgentActor,
    });
    expect(out.map((r) => r.id)).toEqual(['m1']);
  });
});

describe('the circle setting is a CEILING the reader cannot lift', () => {
  it('a stored kind the circle no longer allows is dropped', () => {
    const f = normalizeChatFilter({ kinds: ['task', 'offer'] }, ALLOWED);
    expect(f.kinds).toEqual(['task']);   // 'offer' is not in this circle's conversation
  });

  it('a set covering everything allowed normalises to null, so a NEWLY allowed kind appears', () => {
    const f = normalizeChatFilter({ kinds: [...ALLOWED] }, ALLOWED);
    expect(f.kinds).toBeNull();
    // …and with the circle later allowing one more, the reader sees it.
    expect(applyChatFilter({ rows: ROWS, filter: f, allowedKinds: [...ALLOWED, 'offer'] })).toHaveLength(4);
  });

  it('a stored set that survives nothing falls back to showing everything', () => {
    expect(normalizeChatFilter({ kinds: ['offer'] }, ALLOWED).kinds).toBeNull();
  });
});

describe('the chips', () => {
  it('one chip per allowed kind, plus the three author chips, with state', () => {
    const { kindChips, authorChips, active } = chatFilterChips({ allowedKinds: ALLOWED });
    expect(kindChips.map((c) => c.kind)).toEqual(ALLOWED);
    expect(kindChips.every((c) => c.selected)).toBe(true);
    expect(authorChips.map((c) => c.authors)).toEqual(CHAT_AUTHORS);
    expect(authorChips.find((c) => c.selected).authors).toBe('all');
    expect(active).toBe(false);
  });

  it('a tap returns the NEXT filter — the shells hold no filter logic', () => {
    const { kindChips } = chatFilterChips({ allowedKinds: ALLOWED });
    const next = kindChips.find((c) => c.kind === 'task').nextFilter;
    expect(next.kinds).toEqual(['ask', 'chat-message']);
    expect(chatFilterChips({ allowedKinds: ALLOWED, filter: next }).active).toBe(true);
  });

  it('the LAST remaining kind cannot be switched off — no self-inflicted empty conversation', () => {
    const one = normalizeChatFilter({ kinds: ['task'] }, ALLOWED);
    const { kindChips } = chatFilterChips({ allowedKinds: ALLOWED, filter: one });
    const task = kindChips.find((c) => c.kind === 'task');
    expect(task.selected).toBe(true);
    expect(task.disabled).toBe(true);
    expect(task.nextFilter.kinds).toEqual(['task']);   // a tap changes nothing
  });
});

describe('persistence is device-local and defaults to absent', () => {
  it('the default filter is REMOVED rather than stored (no key for "I changed nothing")', () => {
    const mem = new Map();
    const io = localStorageChatFilterIo({
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => mem.set(k, v),
      removeItem: (k) => mem.delete(k),
    });
    io.save('c1', { kinds: ['task'], authors: 'people' });
    expect(io.load('c1')).toEqual({ kinds: ['task'], authors: 'people' });
    io.save('c1', DEFAULT_CHAT_FILTER);
    expect(io.load('c1')).toBeNull();
  });

  it('a broken storage read degrades to the default rather than throwing', () => {
    const io = localStorageChatFilterIo({ getItem: () => '{not json', setItem: () => {}, removeItem: () => {} });
    expect(normalizeChatFilter(io.load('c1'), ALLOWED)).toEqual(DEFAULT_CHAT_FILTER);
  });
});
