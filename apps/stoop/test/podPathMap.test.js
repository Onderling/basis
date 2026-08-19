/**
 * podPathMap — Stoop mem://↔storage-function classifier.
 * Round-trips the spec rows + the colon-encoding regression
 * (`webid:local:<peer>` was the original 404 cause).
 */

import { describe, it, expect } from 'vitest';
import { classify, unclassify } from '../src/lib/podPathMap.js';

function roundtrip(mem, ctx) {
  const c = classify(mem, ctx);
  expect(c).not.toBeNull();
  expect(unclassify(c.storageFn, c.tail)).toBe(mem);
  return c;
}

describe('podPathMap.classify/unclassify', () => {
  it('offers/requests → group/<circle>/items (round-trips)', () => {
    const c = roundtrip('mem://neighbourhood/items/01ABC.json', { circleId: 'C' });
    expect(c).toEqual({ storageFn: 'group/C/items', tail: '01ABC.json' });
  });

  it('roster member key passes through verbatim — NOT double-encoded (the device-pass bug)', () => {
    // Real runtime key: MemberMapCache already encodeURIComponent's
    // the peer id, so the mem:// segment is ALREADY `webid%3Alocal%3A…`.
    // The classifier must NOT re-encode it (that produced `%253A`).
    const c = roundtrip('mem://neighbourhood/members/webid%3Alocal%3AOVUaJV0', { circleId: 'C' });
    expect(c.storageFn).toBe('group/C/members');
    expect(c.tail).toBe('webid%3Alocal%3AOVUaJV0');     // verbatim — no %253A
    expect(c.tail).not.toContain('%253A');
  });

  it('item attachments → group/<circle>/item-attachments (distinct from items)', () => {
    const c = roundtrip('mem://stoop/items/01X/attachments/a.jpg', { circleId: 'C' });
    expect(c.storageFn).toBe('group/C/item-attachments');
  });

  it('group governance → group/<circle>/governance', () => {
    const c = roundtrip('mem://neighbourhood/groups/G1/config.json', { circleId: 'C' });
    expect(c.storageFn).toBe('group/C/governance');
  });

  it('group audit log → group/<circle>/audit (device-pass #2 UNROUTED gap)', () => {
    const c = roundtrip('mem://neighbourhood/audit/01KRVSN68BDV6JA896N7N4RJBY.json', { circleId: 'C' });
    expect(c.storageFn).toBe('group/C/audit');
    expect(c.tail).toBe('01KRVSN68BDV6JA896N7N4RJBY.json');
  });

  it('threads → sharing/threads', () => {
    const c = roundtrip('mem://stoop/threads/t1.json');
    expect(c.storageFn).toBe('sharing/threads');
  });

  it('private plumbing (exact + prefix) → private/state with stoop/ sub-key', () => {
    expect(classify('mem://stoop/reveals.json')).toEqual({
      storageFn: 'private/state', tail: 'stoop/reveals.json',
    });
    expect(unclassify('private/state', 'stoop/reveals.json')).toBe('mem://stoop/reveals.json');
    roundtrip('mem://stoop/push-subscriptions.json');
    roundtrip('mem://stoop/interest-profile.json');
    roundtrip('mem://stoop/lists/abc.json');
    roundtrip('mem://stoop/avatars/alice.png');
  });

  it('returns null for out-of-scope / unroutable keys', () => {
    expect(classify('mem://stoop/settings/shared.json')).toBeNull();      // cross-app-settings.md owns these
    expect(classify('mem://stoop/settings/devices/d.json')).toBeNull();
    expect(classify('mem://neighbourhood/weird/x')).toBeNull();
    expect(classify('not-a-mem-key')).toBeNull();
    // circle-scoped key but no active circle → skip (don't half-route)
    expect(classify('mem://neighbourhood/items/1.json')).toBeNull();
    expect(classify('mem://neighbourhood/items/1.json', {})).toBeNull();
  });

  it('unclassify rejects garbage', () => {
    expect(unclassify('group/C/unknown', 'x')).toBeNull();
    expect(unclassify(42, 'x')).toBeNull();
  });
});
