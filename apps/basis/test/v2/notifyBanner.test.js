/**
 * The in-app banner over "Nieuw voor jou"'s rows: only what is new since the last reading, of a banner kind, for a
 * ticked persona, not on the screen the person is on; a burst is one banner with a count.
 */
import { describe, it, expect } from 'vitest';
import { bannerFor, createBannerDriver, NOTIFY_POLICY_PARAMS, NOTIFY_POLICY_DEFAULTS } from '../../src/v2/notifyBanner.js';

const t = (k, v = {}) => `${k.split('.').pop()}${Object.keys(v).length ? ` ${JSON.stringify(v)}` : ''}`;
const dm = (id, contact = 'bea', self = null) => ({ id, kind: 'dm', text: `Bea: ${id}`, open: { kind: 'thread', id: contact }, ...(self ? { self: { id: self } } : {}) });
const line = (id) => ({ id, kind: 'line', text: id, open: { kind: 'circle', id: 'c1' } });

describe('bannerFor', () => {
  it('the first reading only seeds: what was there when the app opened is never a banner', () => {
    const r = bannerFor({ rows: [dm('d1')], known: null, t });
    expect(r.banner).toBe(null);
    expect([...r.known]).toEqual(['d1']);
  });
  it('a new direct message is a banner that opens its thread; a new line in a circle is only a row', () => {
    const r = bannerFor({ rows: [dm('d2'), line('m1'), dm('d1')], known: new Set(['d1']), t });
    expect(r.banner).toMatchObject({ count: 1, text: 'Bea: d2', open: { kind: 'thread', id: 'bea' } });
  });
  it('what arrived before the app opened never rings, even when it is read for the first time later (turns load late)', () => {
    const r = bannerFor({ rows: [{ ...dm('old'), at: 100 }, { ...dm('new'), at: 300 }], known: new Set(), since: 200, t });
    expect(r.banner).toMatchObject({ count: 1, text: 'Bea: new' });
  });
  it('no banner while the person is on the source', () => {
    const r = bannerFor({ rows: [dm('d2')], known: new Set(), onSource: (o) => o.kind === 'thread' && o.id === 'bea', t });
    expect(r.banner).toBe(null);
  });
  it('a burst gives one banner with a count, opening nothing in particular', () => {
    const r = bannerFor({ rows: [dm('d3', 'cas'), dm('d2')], known: new Set(), t });
    expect(r.banner).toMatchObject({ count: 2, open: null, text: 'banner_many {"count":2}' });
  });
  it('only for the personas ticked in the switcher (rows for the others stay on Today)', () => {
    const rows = [dm('d4', 'bea', 'werk')];
    expect(bannerFor({ rows, known: new Set(), selvesOn: ['default'], t }).banner).toBe(null);
    expect(bannerFor({ rows, known: new Set(), selvesOn: ['default', 'werk'], t }).banner?.count).toBe(1);
  });
  it('the person\'s policy table decides: a line set to banner rings, a direct message set to off does not', () => {
    const policyOf = (k) => ({ line: 'banner', dm: 'off' })[k];
    const r = bannerFor({ rows: [dm('d5'), line('m2')], known: new Set(), policyOf, t });
    expect(r.banner).toMatchObject({ count: 1, text: 'm2' });
  });
  it('the table is one person-settable param per kind, with the note\'s defaults', () => {
    expect(NOTIFY_POLICY_PARAMS.map((p) => [p.key, p.default])).toEqual(Object.entries(NOTIFY_POLICY_DEFAULTS).map(([k, d]) => [`notify.policy.${k}`, d]));
    expect(NOTIFY_POLICY_PARAMS.every((p) => p.kind === 'user' && p.choices.includes('off'))).toBe(true);
  });
});

describe('createBannerDriver', () => {
  it('seeds on the first poke, shows what is new on the next, hides after the time; newest wins', async () => {
    let rows = [dm('d1')];
    const shown = [];
    let hidden = 0;
    const timers = [];
    const d = createBannerDriver({
      readRows: () => rows, t, show: (b) => shown.push(b.text), hide: () => { hidden += 1; },
      setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer: () => {}, now: () => 0,
    });
    await d.poke();
    expect(shown).toEqual([]);
    rows = [dm('d2'), dm('d1')];
    await Promise.all([d.poke(), d.poke()]);   // two pokes in a burst: one banner
    expect(shown).toEqual(['Bea: d2']);
    timers.at(-1)();
    expect(hidden).toBe(1);
  });
});
