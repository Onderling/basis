/**
 * S6.C — the preference layer that picks which projection a bot reply renders.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  selectSurfaceButtons, normalizeSurfacePref, createSurfacePrefStore, DEFAULT_SURFACE_PREF,
  registerSurfacePrefIo,
} from '../src/v2/surfacePref.js';

const inline = [{ id: 'claimTask:t1', opId: 'claimTask', itemId: 't1' }];
const screen = [{ id: 'screen:tasks', screen: 'tasks' }];

describe('selectSurfaceButtons', () => {
  it('inline (default): screen button + per-item inline buttons', () => {
    expect(selectSurfaceButtons({ inlineButtons: inline, screenButton: screen, pref: 'inline' }))
      .toEqual([...screen, ...inline]);
    // unknown pref falls back to inline
    expect(selectSurfaceButtons({ inlineButtons: inline, screenButton: screen, pref: 'bogus' }))
      .toEqual([...screen, ...inline]);
  });
  it('screen: prefer the screen, suppress per-item buttons', () => {
    expect(selectSurfaceButtons({ inlineButtons: inline, screenButton: screen, pref: 'screen' })).toEqual(screen);
  });
  it('screen with no screen surface falls back to inline buttons', () => {
    expect(selectSurfaceButtons({ inlineButtons: inline, screenButton: [], pref: 'screen' })).toEqual(inline);
  });
  it('chat: no buttons (text/AI only)', () => {
    expect(selectSurfaceButtons({ inlineButtons: inline, screenButton: screen, pref: 'chat' })).toEqual([]);
  });
});

describe('normalizeSurfacePref', () => {
  it('keeps known prefs, defaults unknown', () => {
    expect(normalizeSurfacePref('screen')).toBe('screen');
    expect(normalizeSurfacePref('nope')).toBe(DEFAULT_SURFACE_PREF);
    expect(normalizeSurfacePref(undefined)).toBe('inline');
  });
});

describe('createSurfacePrefStore', () => {
  it('hydrates from io, defaults on miss, persists on set', async () => {
    let backing = 'screen';
    const io = { get: vi.fn(async () => backing), set: vi.fn(async (v) => { backing = v; }) };
    const store = createSurfacePrefStore(io);
    expect(store.get()).toBe('inline');               // pre-hydrate default
    expect(await store.hydrate()).toBe('screen');
    expect(store.get()).toBe('screen');
    await store.set('chat');
    expect(store.get()).toBe('chat');
    expect(io.set).toHaveBeenCalledWith('chat');
    await store.set('garbage');                        // normalized
    expect(store.get()).toBe('inline');
  });

  it('works over the REGISTER io (the device-params consolidation): reads mirror the register, writes ride set-param', async () => {
    // A minimal agent: the register value + the one kind-gated write.
    let value = 'inline';
    const calls = [];
    const agent = {
      getParamValue: (k) => (k === 'surface.pref' ? value : undefined),
      callSkill: async (app, op, args) => { calls.push([app, op, args]); value = args.value; return { ok: true }; },
    };
    // The thunk resolves late (both shells construct the store pre-boot).
    let bound = null;
    const store = createSurfacePrefStore(registerSurfacePrefIo(() => bound));
    expect(await store.hydrate()).toBe('inline');          // unbound → default, never a throw
    bound = agent;
    await store.set('screen');
    expect(calls).toEqual([['params', 'set-param', { key: 'surface.pref', value: 'screen' }]]);
    const reloaded = createSurfacePrefStore(registerSurfacePrefIo(() => bound));
    expect(await reloaded.hydrate()).toBe('screen');       // the register is the one persistence
  });
});
