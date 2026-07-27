/**
 * The circle-aware peer scope — basis's answer to "what may this caller learn?" (G7, adoption half).
 *
 * The oracle's claim is a contact graph. The rule: **you learn only about peers you already share a circle
 * with** — which adds a reachability fact to something you already know, rather than an identity you did
 * not. Everything else discloses nothing, and a withheld peer is ABSENT rather than marked, so a stranger
 * cannot tell whether this device has peers at all.
 */
import { describe, it, expect } from 'vitest';
import { makeSharedCirclePeerScope } from '../../src/v2/sharedCirclePeerScope.js';

const ANNA = 'pk-anna';       // this device
const BRAM = 'pk-bram';
const CATO = 'pk-cato';
const DIRK = 'pk-dirk';
const STRANGER = 'pk-stranger';

/** Anna is in X (with Bram) and Y (with Cato). Dirk is reachable but shares nothing. */
const ROSTERS = {
  x: [{ addr: ANNA }, { addr: BRAM }],
  y: [{ addr: ANNA }, { addr: CATO }],
};
const REACHABLE = [BRAM, CATO, DIRK];

const scope = (over = {}) => makeSharedCirclePeerScope({
  myCircleIds: async () => Object.keys(ROSTERS),
  rosterOf: async (id) => ROSTERS[id] ?? [],
  ...over,
});

describe('you learn only about peers you already share a circle with', () => {
  it('Bram (circle X) learns about his co-members and nothing else', async () => {
    expect(await scope()(BRAM, REACHABLE)).toEqual([BRAM]);
  });

  it('Cato (circle Y) gets a DIFFERENT answer from the same device', async () => {
    expect(await scope()(CATO, REACHABLE)).toEqual([CATO]);
  });

  it('a stranger learns nothing, and cannot tell there is anything to learn', async () => {
    expect(await scope()(STRANGER, REACHABLE)).toEqual([]);
  });

  it('DIRK is never disclosed — reachable, but shares no circle with anyone asking', async () => {
    for (const caller of [BRAM, CATO, STRANGER]) {
      expect(await scope()(caller, REACHABLE)).not.toContain(DIRK);
    }
  });

  it('a caller in BOTH circles sees both, still only their co-members', async () => {
    const rosters = { x: [{ addr: ANNA }, { addr: BRAM }, { addr: CATO }], y: [{ addr: ANNA }, { addr: CATO }] };
    const s = makeSharedCirclePeerScope({
      myCircleIds: async () => ['x', 'y'], rosterOf: async (id) => rosters[id] ?? [],
    });
    expect(await s(CATO, REACHABLE)).toEqual([BRAM, CATO]);
    expect(await s(CATO, REACHABLE)).not.toContain(DIRK);
  });

  it('MY other circles are none of the caller\'s business', async () => {
    // The boundary per-circle identity exists to hold: Bram must not learn about Cato just because I am in
    // a circle with each of them separately.
    expect(await scope()(BRAM, REACHABLE)).not.toContain(CATO);
  });

  it('a roster keyed on webid still matches a caller identified by pubKey', async () => {
    const rosters = { x: [{ webid: ANNA }, { webid: BRAM, pubKey: BRAM }] };
    const s = makeSharedCirclePeerScope({
      myCircleIds: async () => ['x'], rosterOf: async (id) => rosters[id] ?? [],
    });
    expect(await s(BRAM, [BRAM])).toEqual([BRAM]);
  });
});

describe('deny-by-default on every failure path', () => {
  it.each([
    ['no caller', null],
    ['empty caller', ''],
    ['a non-string caller', 42],
  ])('%s ⇒ nothing', async (_label, caller) => {
    expect(await scope()(caller, REACHABLE)).toEqual([]);
  });

  it('an unreadable roster discloses nothing for that circle rather than throwing', async () => {
    const s = makeSharedCirclePeerScope({
      myCircleIds: async () => ['x', 'y'],
      rosterOf: async (id) => { if (id === 'x') throw new Error('pod down'); return ROSTERS[id]; },
    });
    expect(await s(BRAM, REACHABLE)).toEqual([]);      // X was Bram's only circle
    expect(await s(CATO, REACHABLE)).toEqual([CATO]);  // …and Y is unaffected
  });

  it('an unreadable circle LIST discloses nothing at all', async () => {
    const s = makeSharedCirclePeerScope({
      myCircleIds: async () => { throw new Error('no store'); }, rosterOf: async () => [],
    });
    expect(await s(BRAM, REACHABLE)).toEqual([]);
  });

  it('never WIDENS — only ever a subset of what this device can actually reach', async () => {
    // Defence against a roster naming someone we are not connected to: the claim is signed, so it must
    // never vouch for a peer this device cannot reach.
    const rosters = { x: [{ addr: ANNA }, { addr: BRAM }, { addr: 'pk-ghost' }] };
    const s = makeSharedCirclePeerScope({
      myCircleIds: async () => ['x'], rosterOf: async (id) => rosters[id] ?? [],
    });
    expect(await s(BRAM, [BRAM])).toEqual([BRAM]);     // ghost is in the roster but not reachable
  });

  it('an empty reachable set is empty for everyone', async () => {
    expect(await scope()(BRAM, [])).toEqual([]);
  });
});

describe('the roster cache does not outlive its usefulness', () => {
  it('re-reads after the TTL, so a removed member stops being disclosed about', async () => {
    let reads = 0;
    let roster = [{ addr: ANNA }, { addr: BRAM }, { addr: CATO }];
    let clock = 1_000;
    const s = makeSharedCirclePeerScope({
      myCircleIds: async () => ['x'],
      rosterOf: async () => { reads += 1; return roster; },
      now: () => clock, ttlMs: 30_000,
    });

    expect(await s(BRAM, REACHABLE)).toEqual([BRAM, CATO]);
    await s(BRAM, REACHABLE);
    expect(reads, 'served from cache within the TTL').toBe(1);

    roster = [{ addr: ANNA }, { addr: BRAM }];          // Cato is removed
    clock += 60_000;
    expect(await s(BRAM, REACHABLE)).toEqual([BRAM]);
    expect(reads).toBe(2);
  });
});
