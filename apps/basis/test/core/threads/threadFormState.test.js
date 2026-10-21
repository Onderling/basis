/**
 * threadFormState — unit tests for the pure state-machine helpers
 * lifted from the v1 web thread sidebar (2026-05-24; that renderer retired 2026-10-22).
 *
 * Zero DOM, zero RN — the whole point is that basis-mobile
 * can rely on these same functions when it ships an RN sidebar.
 */
import { describe, it, expect } from 'vitest';

import {
  KNOWN_EVENT_TYPES,
  mergeKnownEventTypes,
  parseList,
  buildFilterFromFormState,
  emptyFormState,
  formStateFromThread,
  submitThreadForm,
} from '../../../src/core/threads/threadFormState.js';

describe('parseList', () => {
  it('splits on commas + whitespace, trims, drops empties', () => {
    expect(parseList('webid:anne, webid:frits')).toEqual(['webid:anne', 'webid:frits']);
    expect(parseList(' a  , b ,, c ')).toEqual(['a', 'b', 'c']);
    expect(parseList('')).toEqual([]);
    expect(parseList(null)).toEqual([]);
    expect(parseList(undefined)).toEqual([]);
  });
});

describe('mergeKnownEventTypes', () => {
  it('returns the built-in list when no extras passed', () => {
    expect(mergeKnownEventTypes()).toEqual(KNOWN_EVENT_TYPES);
  });
  it('puts extras FIRST + dedups', () => {
    const out = mergeKnownEventTypes(['custom-a', 'notification']);
    expect(out[0]).toBe('custom-a');
    expect(out.indexOf('notification')).toBe(1);
    // No duplicate 'notification' from KNOWN_EVENT_TYPES.
    expect(out.filter((t) => t === 'notification').length).toBe(1);
  });
});

describe('buildFilterFromFormState', () => {
  it('omits empty slots (wildcard semantics)', () => {
    const state = { apps: new Set(), types: new Set(), actors: '' };
    expect(buildFilterFromFormState(state)).toEqual({});
  });
  it('includes only the populated slots', () => {
    const state = {
      apps:   new Set(['pinboard']),
      types:  new Set(),
      actors: 'webid:anne, webid:frits',
    };
    expect(buildFilterFromFormState(state)).toEqual({
      apps:   ['pinboard'],
      actors: ['webid:anne', 'webid:frits'],
    });
  });
  it('renders all three slots together when all populated', () => {
    const state = {
      apps:   new Set(['pinboard', 'household']),
      types:  new Set(['notification']),
      actors: 'webid:anne',
    };
    expect(buildFilterFromFormState(state)).toEqual({
      apps:       ['pinboard', 'household'],
      eventTypes: ['notification'],
      actors:     ['webid:anne'],
    });
  });
});

describe('emptyFormState + formStateFromThread', () => {
  it('emptyFormState is a default new-thread shape', () => {
    const s = emptyFormState();
    expect(s.name).toBe('');
    expect(s.apps).toBeInstanceOf(Set);
    expect(s.types).toBeInstanceOf(Set);
    expect(s.actors).toBe('');
    expect(s.allowCommands).toBe(true);
  });
  it('formStateFromThread maps existing thread → form state', () => {
    const existing = {
      id: 't-1', name: 'My thread',
      filter: { apps: ['pinboard'], eventTypes: ['mention'], actors: ['webid:anne'] },
      permissions: { allowCommands: false },
    };
    const s = formStateFromThread(existing);
    expect(s.name).toBe('My thread');
    expect([...s.apps]).toEqual(['pinboard']);
    expect([...s.types]).toEqual(['mention']);
    expect(s.actors).toBe('webid:anne');
    expect(s.allowCommands).toBe(false);
  });
  it('formStateFromThread defaults sensibly on a partial thread', () => {
    const s = formStateFromThread({ name: 'Bare' });
    expect(s.apps.size).toBe(0);
    expect(s.types.size).toBe(0);
    expect(s.actors).toBe('');
    expect(s.allowCommands).toBe(true);
  });
});

describe('submitThreadForm', () => {
  function makeFakeStore() {
    return {
      _created: [],
      _updated: [],
      createThread(opts) { const t = { id: `t-${this._created.length + 1}`, ...opts }; this._created.push(t); return t; },
      updateThread(id, patch) { this._updated.push({ id, patch }); },
    };
  }

  it('rejects empty-name with reason=name-required', () => {
    const store = makeFakeStore();
    const r = submitThreadForm({ name: '   ', apps: new Set(), types: new Set(), actors: '' }, store);
    expect(r).toEqual({ ok: false, reason: 'name-required' });
    expect(store._created).toHaveLength(0);
  });

  it('creates a new thread when no existingThread', () => {
    const store = makeFakeStore();
    const r = submitThreadForm(
      { name: 'My thread', apps: new Set(['pinboard']), types: new Set(), actors: '', allowCommands: true },
      store,
    );
    expect(r.ok).toBe(true);
    expect(r.created).toBe(true);
    expect(r.threadId).toBe('t-1');
    expect(store._created[0].name).toBe('My thread');
    expect(store._created[0].filter).toEqual({ apps: ['pinboard'] });
    expect(store._created[0].permissions).toEqual({ allowCommands: true });
  });

  it('updates an existing thread when existingThread passed', () => {
    const store = makeFakeStore();
    const r = submitThreadForm(
      { name: 'Renamed', apps: new Set(), types: new Set(['mention']), actors: '', allowCommands: false },
      store,
      { existingThread: { id: 't-99', name: 'Old', filter: {}, permissions: {} } },
    );
    expect(r.ok).toBe(true);
    expect(r.created).toBe(false);
    expect(r.threadId).toBe('t-99');
    expect(store._created).toHaveLength(0);
    expect(store._updated[0]).toEqual({
      id: 't-99',
      patch: {
        name: 'Renamed',
        filter: { eventTypes: ['mention'] },
        permissions: { allowCommands: false },
      },
    });
  });

  it('trims the name before submit', () => {
    const store = makeFakeStore();
    submitThreadForm(
      { name: '  Spaced  ', apps: new Set(), types: new Set(), actors: '' },
      store,
    );
    expect(store._created[0].name).toBe('Spaced');
  });
});
