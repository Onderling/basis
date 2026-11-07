/**
 * EVERY ACT PAINTS PENDING · DONE · FAILED, ONCE, FOR EVERY OP.
 *
 * The two-phone walk (sitting Part 2 §4): Save said nothing, a join showed nothing for 23 s, Accept made a post vanish
 * in silence. One wrapper around the waist knows when an act starts and how it ended; one strip paints `store.current`.
 */
import { describe, it, expect } from 'vitest';
import {
  createActState, wrapCallSkillWithActState, isActOp, actStateLine, actFailed,
  ACT_PENDING_DELAY_MS, ACT_DONE_SHOWN_MS, ACT_INTERACTION_WINDOW_MS,
} from '../../src/v2/actState.js';
import { basisManifest } from '../../src/index.js';

const t = (k, p = {}) => (Object.keys(p).length ? `${k}(${Object.entries(p).map(([a, b]) => `${a}=${b}`).join(',')})` : k);

/** A clock + timer queue a test drives by hand. */
function fakeTimers() {
  let now = 1000; const q = [];
  return {
    now: () => now,
    setTimer: (fn, ms) => { const h = { at: now + ms, fn }; q.push(h); return h; },
    clearTimer: (h) => { const i = q.indexOf(h); if (i >= 0) q.splice(i, 1); },
    advance: (ms) => { now += ms; for (const h of [...q].sort((a, b) => a.at - b.at)) { if (h.at <= now) { q.splice(q.indexOf(h), 1); h.fn(); } } },
  };
}
const MANIFESTS = {
  basis: basisManifest,
  lists: { operations: [{ id: 'addToList', verb: 'add' }, { id: 'listLists', verb: 'list' }, { id: 'editEntry', verb: 'edit' }, { id: 'peek', verb: 'glance' }, { id: 'undoIt', verb: 'undo' }], domainVerbs: { glance: 'read', undo: 'write' } },
};

describe('what counts as an act', () => {
  it('a writing atom (alias-aware) is; a read is not; a domain verb follows the manifest; an unknown op is no claim', () => {
    expect(isActOp(MANIFESTS, 'lists', 'addToList')).toBe(true);
    expect(isActOp(MANIFESTS, 'lists', 'editEntry'), 'edit is an alias of update').toBe(true);
    expect(isActOp(MANIFESTS, 'lists', 'listLists')).toBe(false);
    expect(isActOp(MANIFESTS, 'lists', 'peek'), 'domainVerbs: read').toBe(false);
    expect(isActOp(MANIFESTS, 'lists', 'undoIt'), 'domainVerbs: write').toBe(true);
    expect(isActOp(MANIFESTS, 'basis', 'help')).toBe(false);
    expect(isActOp(MANIFESTS, 'nobody', 'addToList')).toBe(false);
    expect(isActOp(() => MANIFESTS, 'lists', 'addToList'), 'a getter works too').toBe(true);
  });
  it('an op whose own bubble carries its state stays quiet', () => {
    expect(isActOp({ pinboard: { operations: [{ id: 'broadcastCircleChatStatement', verb: 'add' }] } }, 'pinboard', 'broadcastCircleChatStatement')).toBe(false);
  });
  it('failure by the waist\'s conventions', () => {
    expect(actFailed({ ok: false })).toBe(true);
    expect(actFailed({ error: 'nee' })).toBe(true);
    expect(actFailed({ ok: true })).toBe(false);
    expect(actFailed(undefined)).toBe(false);
  });
});

describe('one act on the store', () => {
  it('pending paints only after the delay; done shows for a while and clears', async () => {
    const tm = fakeTimers();
    const store = createActState(tm);
    const seen = []; store.subscribe((c) => seen.push(c?.state ?? null));
    const token = store.begin({ appOrigin: 'lists', opId: 'addToList', args: {} });
    expect(store.current, 'nothing yet: a fast act never flickers').toBeNull();
    tm.advance(ACT_PENDING_DELAY_MS);
    expect(store.current?.state).toBe('pending');
    store.end(token, { result: { ok: true } });
    expect(store.current?.state).toBe('done');
    tm.advance(ACT_DONE_SHOWN_MS);
    expect(store.current).toBeNull();
    expect(seen).toEqual(['pending', 'done', null]);
  });
  it('an act that ends before the delay paints done without a pending flash; failed stays until the next act', () => {
    const tm = fakeTimers();
    const store = createActState(tm);
    const a = store.begin({ appOrigin: 'lists', opId: 'addToList' });
    tm.advance(50);
    store.end(a, { result: { ok: false, error: 'kapot' } });
    expect(store.current?.state).toBe('failed');
    tm.advance(ACT_DONE_SHOWN_MS * 10);
    expect(store.current?.state, 'failed does not clear by itself').toBe('failed');
    const b = store.begin({ appOrigin: 'lists', opId: 'addToList' });
    expect(store.current, 'a new act takes the strip').toBeNull();
    store.end(b, { result: {} });
    expect(store.current?.state).toBe('done');
  });
  it('only the newest act paints its end', () => {
    const tm = fakeTimers();
    const store = createActState(tm);
    const a = store.begin({ appOrigin: 'lists', opId: 'addToList' });
    const b = store.begin({ appOrigin: 'lists', opId: 'editEntry' });
    store.end(a, { error: new Error('late') });
    expect(store.current, 'the older act is forgotten').toBeNull();
    store.end(b, { result: {} });
    expect(store.current?.opId).toBe('editEntry');
  });
});

describe('the waist, wrapped', () => {
  const calls = [];
  const raw = async (o, id, args) => { calls.push([o, id]); if (id === 'editEntry') throw new Error('boom'); return { ok: true, id }; };
  it('an act the person just took is followed; a read, a background call and an unknown op pass through untouched', async () => {
    const tm = fakeTimers();
    const store = createActState(tm);
    const call = wrapCallSkillWithActState(raw, { store, manifestsByOrigin: MANIFESTS });
    expect(await call('lists', 'addToList', {}), 'no interaction: background').toEqual({ ok: true, id: 'addToList' });
    expect(store.current).toBeNull();
    store.noteInteraction();
    expect(await call('lists', 'listLists', {})).toEqual({ ok: true, id: 'listLists' });
    expect(store.current, 'a read paints nothing').toBeNull();
    const r = await call('lists', 'addToList', { text: 'melk' });
    expect(r).toEqual({ ok: true, id: 'addToList' });
    expect(store.current?.state).toBe('done');
    tm.advance(ACT_INTERACTION_WINDOW_MS + 1);
    await call('lists', 'addToList', {});
    expect(store.current?.state, 'the window closed: the earlier done still shows, no new act').toBe('done');
    expect(calls.length).toBe(4);
  });
  it('a throw is failed and still thrown to the caller', async () => {
    const store = createActState(fakeTimers());
    const call = wrapCallSkillWithActState(raw, { store, manifestsByOrigin: MANIFESTS });
    store.noteInteraction();
    await expect(call('lists', 'editEntry', {})).rejects.toThrow('boom');
    expect(store.current?.state).toBe('failed');
    expect(store.current?.error).toBe('boom');
  });
  it('without a store it is the same function', () => {
    expect(wrapCallSkillWithActState(raw, {})).toBe(raw);
  });
  it('an act the host follows by hand (a Save that is no op) needs no interaction window and keeps its result', async () => {
    const tm = fakeTimers();
    const store = createActState(tm);
    expect(await store.track({ opId: 'circle-settings-save' }, Promise.resolve({ saved: true }))).toEqual({ saved: true });
    expect(store.current).toEqual(expect.objectContaining({ state: 'done', opId: 'circle-settings-save' }));
    await expect(store.track({ opId: 'circle-settings-save' }, Promise.reject(new Error('disk')))).rejects.toThrow('disk');
    expect(store.current?.state).toBe('failed');
  });
});

describe('the words', () => {
  it('pending and done are the generic lines; done takes the op family\'s own line when it has one', () => {
    expect(actStateLine({ state: 'pending' }, { t })).toEqual({ state: 'pending', text: 'circle.act.pending' });
    expect(actStateLine({ state: 'done', opId: 'nothingKnown', result: {} }, { t })).toEqual({ state: 'done', text: 'circle.act.done' });
    const done = actStateLine({ state: 'done', opId: 'addToList', args: { list: 'Boodschappen', text: 'melk' }, result: { ok: true, list: 'Boodschappen', entry: 'melk' } }, { t });
    expect(done.state).toBe('done');
    expect(done.text, 'the family line, not the generic word').not.toBe('circle.act.done');
  });
  it('failed names the error when there is one', () => {
    expect(actStateLine({ state: 'failed', error: 'kapot' }, { t }).text).toBe('circle.act.failed_with(error=kapot)');
    expect(actStateLine({ state: 'failed', result: { ok: false, error: 'nee' } }, { t }).text).toBe('circle.act.failed_with(error=nee)');
    expect(actStateLine({ state: 'failed' }, { t }).text).toBe('circle.act.failed');
    expect(actStateLine(null, { t })).toBeNull();
  });
});
