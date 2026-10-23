/**
 * Matches under my own ask — the shared projection both shells paint, and the per-device Skip.
 * Asker only; from what members RELEASED (the roster row's `offerings`); nothing written to the circle.
 */
import { describe, it, expect } from 'vitest';
import { askMatchChoices, askMatchThreadId, createAskMatchSkips } from '../../src/v2/askMatches.js';

const ME = 'https://me.example/profile#me';
const BRAM = 'https://bram.example/profile#me';
const CATO = 'https://cato.example/profile#me';
const members = [
  { id: ME, handle: 'me', offerings: [{ key: 'o1', kind: 'offering', text: 'bike repair' }] },
  { id: BRAM, handle: 'bram', circleAddress: 'addr-bram', offerings: [{ key: 'o2', kind: 'offering', text: 'I fix bikes and bike repair' }] },
  { id: CATO, handle: 'cato', circleAddress: 'addr-cato' },
  { id: 'https://dan.example/profile#me', handle: 'dan', offerings: [{ key: 'o3', kind: 'offering', text: 'bike repair' }] },
];
const ask = { id: 'p1', type: 'request', text: 'who can do a bike repair?', addedBy: ME };

describe('askMatchChoices', () => {
  it('shows the asker the members whose released offering matches — never the asker', () => {
    const out = askMatchChoices(ask, { viewerId: ME, members });
    expect(out.map((m) => m.webid)).toEqual([BRAM]);
    expect(out[0]).toMatchObject({ label: '@bram', address: 'addr-bram', offering: 'I fix bikes and bike repair' });
  });

  it('leaves out a match with no address here (Dan offers it, but nobody can ask him)', () => {
    expect(askMatchChoices(ask, { viewerId: ME, members }).some((m) => m.label.includes('dan'))).toBe(false);
  });

  it('Ask opens the thread keyed by the person behind the address', () => {
    const [bram] = askMatchChoices(ask, { viewerId: ME, members });
    expect(askMatchThreadId(bram, { identityOf: (a) => (a === 'addr-bram' ? 'bram-person' : a) })).toBe('bram-person');
  });

  it('shows nothing to anyone but the asker', () => {
    expect(askMatchChoices(ask, { viewerId: BRAM, members })).toEqual([]);
    expect(askMatchChoices(ask, { viewerId: null, members })).toEqual([]);
  });

  it('only under an open ask — not an offer, not a done ask', () => {
    expect(askMatchChoices({ ...ask, type: 'offer' }, { viewerId: ME, members })).toEqual([]);
    expect(askMatchChoices({ ...ask, completedAt: '2026-10-22' }, { viewerId: ME, members })).toEqual([]);
  });

  it('a member with no released offering is matched by nobody', () => {
    expect(askMatchChoices({ ...ask, text: 'cato?' }, { viewerId: ME, members })).toEqual([]);
  });

  it('leaves out who already answered (they carry an Accept) and who I skipped on this device', () => {
    expect(askMatchChoices({ ...ask, source: { responders: [BRAM] } }, { viewerId: ME, members })).toEqual([]);
    expect(askMatchChoices(ask, { viewerId: ME, members, skipped: ['p1|' + BRAM] })).toEqual([]);
  });
});

describe('createAskMatchSkips — a per-device hide', () => {
  it('remembers a skip through the injected io and nothing else', async () => {
    let saved = null;
    const skips = createAskMatchSkips({ load: async () => saved, save: async (v) => { saved = v; } });
    expect(await skips.list()).toEqual([]);
    await skips.add('p1', BRAM);
    await skips.add('p1', BRAM);
    expect(await skips.list()).toEqual(['p1|' + BRAM]);
    expect(askMatchChoices(ask, { viewerId: ME, members, skipped: await skips.list() })).toEqual([]);
  });
});
