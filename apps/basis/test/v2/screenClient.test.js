/**
 * The screen client a toolbox's page imports (ledger L1035, the circle-tools brief's acceptance list): one code for every
 * refusal, a state to await, pairing in steps, abort and time-out per call, storage under a name per toolbox, sign-out.
 * Over a fake view here (the logic is the view's own, tested where it lives); the built file crosses the real relay in
 * screenClient.relay.test.js.
 */
import { describe, it, expect } from 'vitest';
import { createScreenClient, screenClientCode, SCREEN_CLIENT_CODES, SCREEN_CLIENT_VERSION } from '../../src/v2/screenClient.js';
import { encodeScreenStartLink } from '../../src/v2/botScreens.js';

const BOT = encodeScreenStartLink('https://basis.example/app', { botAddress: 'BOTKEY', relayUrl: 'wss://relay.example' });

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); }, removeItem: (k) => { m.delete(k); }, key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, map: m };
}

/** A fake view: what `createScreenView` answers, scripted. */
function fakeViews({ grant = 'granted', answers = {} } = {}) {
  const made = [];
  const createView = ({ link, storage }) => {
    const v = {
      link,
      ops: () => ['tools.useTool', 'lists.listEntries'],
      async connect({ label, toolbox }) { v.offered = { label, toolbox }; return { code: 'AB12', offer: 'onderling-connect://OFFER' }; },
      granted: () => (grant === 'granted' ? Promise.resolve({ tokens: [] }).then((g) => { storage.setItem('onderling.screen.BOTKEY', JSON.stringify({ botAddress: 'BOTKEY' })); return g; }) : Promise.reject(new Error(grant))),
      async resume() { return storage.getItem('onderling.screen.BOTKEY') != null; },
      async call(op, input) { const a = answers[op]; if (typeof a === 'function') return a(input); if (a instanceof Error) throw a; return a ?? { ok: true, op }; },
      onNudge: (fn) => { v.nudge = fn; return () => {}; },
      async stop() { v.stopped = true; },
    };
    made.push(v);
    return v;
  };
  return { createView, made };
}

describe('the screen client', () => {
  it('nothing runs until asked; a version; refuses without a toolbox', () => {
    expect(SCREEN_CLIENT_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    expect(() => createScreenClient({ bot: BOT })).toThrow(/toolbox/);
    const { createView, made } = fakeViews();
    createScreenClient({ toolbox: 'boodschappen', bot: BOT, storage: memoryStorage(), createView });
    expect(made).toHaveLength(0);
  });

  it('pairing in steps: the paste line, the code, when it ends; then granted, and connected', async () => {
    const { createView, made } = fakeViews();
    const c = createScreenClient({ toolbox: 'boodschappen', bot: BOT, storage: memoryStorage(), createView, now: () => 1000 });
    expect(c.state()).toBe('not-paired');
    const p = await c.startPairing();
    expect(p).toEqual({ paste: '/koppel-scherm onderling-connect://OFFER', code: 'AB12', expiresAt: 1000 + 10 * 60 * 1000 });
    expect(made[0].offered).toEqual({ label: 'boodschappen', toolbox: 'boodschappen' });
    const seen = [];
    c.onState((s) => seen.push(s));
    expect(await c.waitForGrant()).toBe('granted');
    expect(c.state()).toBe('connected');
    expect(seen).toEqual(['connected']);
  });

  it('a refused or expired pairing says which', async () => {
    for (const [why, out] of [['refused', 'refused'], ['timed-out', 'expired']]) {
      const c = createScreenClient({ toolbox: 'b', bot: BOT, storage: memoryStorage(), createView: fakeViews({ grant: why }).createView });
      await c.startPairing();
      expect(await c.waitForGrant()).toBe(out);
      expect(c.state()).toBe('not-paired');
    }
  });

  it('storage under a name per toolbox; no stored grant → not-paired ("pair again"); sign-out wipes exactly this toolbox', async () => {
    const storage = memoryStorage();
    storage.setItem('onderling.screen.recepten.onderling.screen.BOTKEY', '{"other":true}');
    const { createView } = fakeViews();
    const c = createScreenClient({ toolbox: 'boodschappen', bot: BOT, storage, createView });
    expect(await c.resume()).toEqual({ ok: false, code: 'not-paired' });
    await c.startPairing(); await c.waitForGrant();
    expect(storage.getItem('onderling.screen.boodschappen.onderling.screen.BOTKEY')).not.toBeNull();
    storage.setItem('onderling-screen:boodschappen:key', 'secret');
    // a fresh page: resumes from what this browser kept
    const again = createScreenClient({ toolbox: 'boodschappen', bot: BOT, storage, createView });
    expect(await again.resume()).toEqual({ ok: true });
    expect(again.state()).toBe('connected');
    await again.signOut();
    expect(again.state()).toBe('not-paired');
    expect(storage.getItem('onderling.screen.boodschappen.onderling.screen.BOTKEY')).toBeNull();
    expect(storage.getItem('onderling-screen:boodschappen:key')).toBeNull();
    expect(storage.getItem('onderling.screen.recepten.onderling.screen.BOTKEY'), 'another toolbox keeps its own').not.toBeNull();
  });

  it('a call: not paired, not allowed, busy while it runs, time-out and abort, a refusal as its code; never a throw', async () => {
    let release;
    const slow = () => new Promise((r) => { release = () => r({ ok: true, items: [] }); });
    const answers = { 'lists.listEntries': slow, 'tools.useTool': { ok: false, code: 'toolbox-timeout' } };
    const { createView } = fakeViews({ answers });
    const c = createScreenClient({ toolbox: 'b', bot: BOT, storage: memoryStorage(), createView });
    expect(await c.call('lists.listEntries')).toEqual({ ok: false, code: 'not-paired' });
    await c.startPairing(); await c.waitForGrant();
    expect(await c.call('lists.removeList')).toEqual({ ok: false, code: 'op-not-allowed' });
    const pending = c.call('lists.listEntries', {});
    expect(c.state()).toBe('busy');
    release();
    expect(await pending).toEqual({ ok: true, items: [] });
    expect(c.state()).toBe('connected');
    expect(await c.call('tools.useTool', {})).toMatchObject({ ok: false, code: 'toolbox-unreachable' });
    expect(await c.call('lists.listEntries', {}, { timeoutMs: 10 })).toMatchObject({ ok: false, code: 'timeout' });
    const ac = new AbortController();
    const aborted = c.call('lists.listEntries', {}, { signal: ac.signal });
    ac.abort();
    expect(await aborted).toMatchObject({ ok: false, code: 'aborted' });
  });

  it('a grant taken away is grant-expired and the screen is not paired; no connection is broken', async () => {
    const { createView } = fakeViews({ answers: { 'lists.listEntries': new Error('INVALID_TOKEN: revoked'), 'tools.useTool': new Error('Relay: not connected') } });
    const c = createScreenClient({ toolbox: 'b', bot: BOT, storage: memoryStorage(), createView });
    await c.startPairing(); await c.waitForGrant();
    expect(await c.call('tools.useTool')).toMatchObject({ ok: false, code: 'no-connection' });
    expect(c.state()).toBe('broken');
    expect(await c.call('lists.listEntries')).toMatchObject({ ok: false, code: 'grant-expired' });
    expect(c.state()).toBe('not-paired');
  });

  it('the code table: every code it gives is in the list; an answer that is no refusal has none', () => {
    for (const e of ['rate-limited', 'INVALID_TOKEN', 'timed-out', 'Relay: not connected', 'screenView: no grant for x', 'AbortError', 'boom']) expect(SCREEN_CLIENT_CODES).toContain(screenClientCode(new Error(e)));
    for (const a of [{ ok: false, code: 'toolbox-not-yours' }, { ok: false, code: 'answer-too-large' }, { ok: false, code: 'tool-error' }, { ok: false, code: 'not-found' }, { ok: false, code: 'whatever' }]) expect(SCREEN_CLIENT_CODES).toContain(screenClientCode(null, a));
    expect(screenClientCode(null, { ok: true })).toBeNull();
  });

  it('whenState resolves when the state comes, and rejects on abort', async () => {
    const { createView } = fakeViews();
    const c = createScreenClient({ toolbox: 'b', bot: BOT, storage: memoryStorage(), createView });
    const connected = c.whenState('connected');
    await c.startPairing(); await c.waitForGrant();
    expect(await connected).toBe('connected');
    const ac = new AbortController();
    const never = c.whenState('broken', { signal: ac.signal });
    ac.abort();
    await expect(never).rejects.toMatchObject({ code: 'aborted' });
  });

  it('a page that reuses one signal does not pile up abort listeners (call and whenState remove theirs when they settle)', async () => {
    const live = new Set();
    const signal = { aborted: false, addEventListener: (_t, fn) => live.add(fn), removeEventListener: (_t, fn) => live.delete(fn) };
    const { createView } = fakeViews();
    const c = createScreenClient({ toolbox: 'b', bot: BOT, storage: memoryStorage(), createView });
    await c.startPairing(); await c.waitForGrant();
    for (let i = 0; i < 5; i += 1) await c.call('lists.listEntries', {}, { signal });
    const busyThenBack = c.whenState('busy', { signal });
    await c.call('lists.listEntries', {});
    await busyThenBack;
    expect(live.size).toBe(0);
  });
});


/**
 * A PAGE RELOADED, BOOKMARKED OR REOPENED RESUMES (ledger L1179, the boodschappen agent 2026-11-22). The bot's address
 * came only from the link's fragment, which the client clears at once (the ticket is one use); after a reload the page
 * had no link and `resume()` answered `not-paired` although the grant was still kept. Now a granted pairing keeps the
 * bot's ADDRESS (public: address, relay, name) under the toolbox's own prefix, never the ticket, and a page opened
 * without the link resumes from it.
 */
describe('a page opened again without the link', () => {
  const pairThenReload = async () => {
    const storage = memoryStorage();
    const first = fakeViews();
    const c1 = createScreenClient({ toolbox: 'boodschappen', bot: BOT, storage, createView: first.createView });
    await c1.startPairing();
    expect(await c1.waitForGrant()).toBe('granted');
    const again = fakeViews();
    const c2 = createScreenClient({ toolbox: 'boodschappen', bot: 'https://basis.example/app', storage, createView: again.createView });
    return { storage, c2, again };
  };

  it('resumes from the kept bot address and the kept grant', async () => {
    const { c2, again } = await pairThenReload();
    expect(await c2.resume()).toEqual({ ok: true });
    expect(c2.state()).toBe('connected');
    expect(again.made[0].link).toContain('BOTKEY');
  });

  it('keeps the address, relay and name, never the ticket, and only under this toolbox', async () => {
    const storage = memoryStorage();
    const withTicket = encodeScreenStartLink('https://basis.example/app', { botAddress: 'BOTKEY', relayUrl: 'wss://relay.example', ticket: 'ONE-USE' });
    const { createView } = fakeViews();
    const c = createScreenClient({ toolbox: 'boodschappen', bot: withTicket, storage, createView });
    await c.startPairing(); await c.waitForGrant();
    const all = [...storage.map].map(([k, v]) => `${k}=${v}`).join('\n');
    expect(all).not.toMatch(/ONE-USE/);
    const keptKeys = [...storage.map.keys()].filter((k) => /BOTKEY/.test(storage.map.get(k)) && !k.endsWith('onderling.screen.BOTKEY'));
    expect(keptKeys.length).toBeGreaterThan(0);
    for (const k of keptKeys) expect(k.startsWith('onderling.screen.boodschappen.')).toBe(true);
  });

  it('another toolbox on the same page address does not resume from it; sign-out forgets it', async () => {
    const { storage, c2 } = await pairThenReload();
    const other = createScreenClient({ toolbox: 'klusjes', bot: 'https://basis.example/app', storage, createView: fakeViews().createView });
    expect((await other.resume()).ok).toBe(false);
    await c2.signOut();
    const c3 = createScreenClient({ toolbox: 'boodschappen', bot: 'https://basis.example/app', storage, createView: fakeViews().createView });
    expect((await c3.resume()).ok).toBe(false);
  });

  it('a page without the link cannot start a pairing (the ticket is the link\'s alone)', async () => {
    const { c2 } = await pairThenReload();
    await expect(c2.startPairing()).rejects.toMatchObject({ code: 'not-paired' });
  });
});
