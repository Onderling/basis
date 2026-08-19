/**
 * podPathMap.reverseResolve — Phase 3.3 inverse of the attach-time
 * toInner. Property: classify → (resolve+join, exactly as Agent.js
 * does) → reverseResolve === the original mem:// key, for every
 * family, under both a real pod base and the pseudo-pod ring.
 */

import { describe, it, expect } from 'vitest';
import { classify, reverseResolve } from '../src/lib/podPathMap.js';

// Mirrors pod-routing.resolve for the test (centralised-on-grp.pod /
// own-pod private+threads / pseudo-pod ring), matching its base shape
// (no trailing slash → toInner appends `/<tail>`).
function mkResolve({ ring = false } = {}) {
  return (storageFn) => {
    if (storageFn.startsWith('group/')) {
      const rest = storageFn.slice('group/'.length);
      return ring
        ? `pseudo-pod://dev/group/${rest}`
        : `https://grp.pod/${rest}`;        // groupPodUri/<circle>/<cat>
    }
    if (storageFn === 'private/state')   return 'https://my.pod/private/state';
    if (storageFn === 'sharing/threads') return 'https://my.pod/sharing/threads';
    return null;
  };
}

// Reproduce Agent.js toInner's join exactly.
function toInner(resolve, mem, circleId) {
  const c = classify(mem, { circleId });
  if (!c) return null;
  const base = resolve(c.storageFn);
  if (!base) return null;
  return base.endsWith('/') ? base + c.tail : `${base}/${c.tail}`;
}

const KEYS = [
  'mem://neighbourhood/items/01KRVSN5V4KE7ND8DMGH474XCQ.json',
  'mem://neighbourhood/members/webid%3Alocal%3AOVUaJV0',
  'mem://neighbourhood/members/OVUaJV0',
  'mem://neighbourhood/audit/01KRVSN68BDV6JA896N7N4RJBY.json',
  'mem://neighbourhood/groups/G1/config.json',
  'mem://stoop/items/01X/attachments/a.jpg',
  'mem://stoop/threads/t1.json',
  'mem://stoop/reveals.json',
  'mem://stoop/lists/abc.json',
  'mem://stoop/avatars/alice.png',
];

describe('podPathMap.reverseResolve — round-trips toInner', () => {
  for (const ring of [false, true]) {
    const resolve = mkResolve({ ring });
    const label = ring ? 'pseudo-pod ring' : 'real pod';
    for (const mem of KEYS) {
      it(`${label}: ${mem}`, () => {
        const podUri = toInner(resolve, mem, 'C');
        expect(podUri).not.toBeNull();
        expect(reverseResolve({ resolve, circleId: 'C', podUri })).toBe(mem);
      });
    }
  }

  it('returns null for a URI under no known storage-function base', () => {
    expect(reverseResolve({ resolve: mkResolve(), circleId: 'C', podUri: 'https://grp.pod/C/unknown/x' }))
      .toBeNull();
    expect(reverseResolve({ resolve: mkResolve(), circleId: 'C', podUri: 'https://elsewhere.pod/x' }))
      .toBeNull();
  });

  it('items vs item-attachments bases do not cross-match (longest base wins)', () => {
    const resolve = mkResolve();
    const att = toInner(resolve, 'mem://stoop/items/01X/attachments/a.jpg', 'C');
    expect(reverseResolve({ resolve, circleId: 'C', podUri: att }))
      .toBe('mem://stoop/items/01X/attachments/a.jpg');
  });

  it('guards bad input', () => {
    expect(reverseResolve({ resolve: null, podUri: 'x' })).toBeNull();
    expect(reverseResolve({ resolve: mkResolve(), podUri: '' })).toBeNull();
  });
});
