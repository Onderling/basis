/**
 * Connection points (Nearby step I, §7).
 *
 * The only question anyone actually asks about a relay is **"if I remove this, what breaks?"** — so most of
 * these tests are about answering it truthfully, and about the distinction that makes the answer useful:
 * a circle with a second point is inconvenienced; a circle left with none is cut off.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createConnectionPoints, POINT_SOURCE, POINT_KIND, adoptExistingRelay,
  localStorageConnectionPointsIo, asyncStorageConnectionPointsIo, recordJoinedCirclePoints,
} from '../../src/v2/connectionPoints.js';

const A = 'wss://a.example';
const B = 'wss://b.example';
const T0 = 1_700_000_000_000;

function build({ initial, save } = {}) {
  let clock = T0;
  return createConnectionPoints({ initial, save, now: () => (clock += 10) });
}

describe('joining populates the list (rule 1)', () => {
  it('redeeming an invite adds the circle’s endpoint, already adopted', () => {
    // You never hand-configure a relay in order to join something — that is the step that loses people.
    const cp = build();
    expect(cp.addFromJoin(A, 'c1')).toEqual({ ok: true });

    const [point] = cp.list();
    expect(point).toMatchObject({ url: A, source: POINT_SOURCE.JOIN, adopted: true, circles: ['c1'] });
  });

  it('a second circle on the same point does not duplicate it', () => {
    const cp = build();
    cp.addFromJoin(A, 'c1');
    cp.addFromJoin(A, 'c2');
    expect(cp.list()).toHaveLength(1);
    expect(cp.circlesFor(A).sort()).toEqual(['c1', 'c2']);
  });

  it('rejects a non-endpoint', () => {
    const cp = build();
    expect(cp.addFromJoin('not-a-url', 'c1')).toMatchObject({ ok: false });
    expect(cp.addManually('http://a.example')).toMatchObject({ ok: false, reason: 'invalid-url' });
    expect(cp.addManually(A)).toEqual({ ok: true });
  });
});

describe('the mapping goes BOTH ways (rule 2)', () => {
  it('answers "which points does this circle have" and "which circles ride this point"', () => {
    // One direction alone cannot answer the removal question.
    const cp = build();
    cp.addFromJoin(A, 'c1');
    cp.addFromJoin(A, 'c2');
    cp.addFromJoin(B, 'c2');

    expect(cp.pointsFor('c2').map((p) => p.url).sort()).toEqual([A, B]);
    expect(cp.pointsFor('c1').map((p) => p.url)).toEqual([A]);
    expect(cp.circlesFor(B)).toEqual(['c2']);
    expect(cp.circlesFor('wss://nope')).toEqual([]);
  });
});

describe('removal is honest (rule 3)', () => {
  it('THE DISTINCTION: cut off vs merely inconvenienced', () => {
    // Presenting these as one list of "affected circles" is how someone clicks through a warning that
    // actually mattered.
    const cp = build();
    cp.addFromJoin(A, 'only-here');     // A is this circle's only point
    cp.addFromJoin(A, 'also-on-b');
    cp.addFromJoin(B, 'also-on-b');

    const impact = cp.impactOfRemoving(A);
    expect(impact.known).toBe(true);
    expect(impact.losesReachability).toEqual(['only-here']);
    expect(impact.stillReachable).toEqual(['also-on-b']);
  });

  it('previewing does NOT remove', () => {
    const cp = build();
    cp.addFromJoin(A, 'c1');
    cp.impactOfRemoving(A);
    expect(cp.list()).toHaveLength(1);
  });

  it('removing returns the same truth, so a caller that skipped the preview still gets it', () => {
    const cp = build();
    cp.addFromJoin(A, 'c1');
    const r = cp.remove(A);
    expect(r).toMatchObject({ ok: true, losesReachability: ['c1'], stillReachable: [] });
    expect(cp.list()).toEqual([]);
  });

  it('a SUGGESTED alternative does not count as still-reachable', () => {
    // A point the device has not adopted is not carrying anything, so counting it would understate the
    // damage — the exact direction a warning must not err in.
    const cp = build();
    cp.addFromJoin(A, 'c1');
    cp.suggest(B, 'c1');

    expect(cp.impactOfRemoving(A).losesReachability).toEqual(['c1']);

    cp.adopt(B);
    expect(cp.impactOfRemoving(A)).toMatchObject({ losesReachability: [], stillReachable: ['c1'] });
  });

  it('removing something unknown says so rather than pretending', () => {
    const cp = build();
    expect(cp.remove('wss://never.seen')).toMatchObject({ ok: false, reason: 'unknown-point' });
    expect(cp.impactOfRemoving('wss://never.seen')).toMatchObject({ known: false, circles: [] });
  });
});

describe('the circle suggests, the device decides (rule 4)', () => {
  it('a suggestion is LISTED but not adopted', () => {
    // Information, not reconfiguration: a circle telling you where it can be reached is not a circle
    // changing how your device connects.
    const cp = build();
    cp.suggest(A, 'c1');
    const [point] = cp.list();
    expect(point).toMatchObject({ source: POINT_SOURCE.SUGGESTED, adopted: false, circles: ['c1'] });
  });

  it('adopting is a separate act', () => {
    const cp = build();
    cp.suggest(A, 'c1');
    expect(cp.adopt(A)).toEqual({ ok: true });
    expect(cp.list()[0].adopted).toBe(true);
  });

  it('a suggestion for a point I already use just adds the circle', () => {
    const cp = build();
    cp.addFromJoin(A, 'c1');
    expect(cp.suggest(A, 'c2')).toMatchObject({ ok: true, alreadyKnown: true });
    expect(cp.list()[0].adopted).toBe(true);          // and does NOT un-adopt it
    expect(cp.circlesFor(A).sort()).toEqual(['c1', 'c2']);
  });

  it('adopting something unknown fails rather than inventing a point', () => {
    expect(build().adopt('wss://never.seen')).toMatchObject({ ok: false, reason: 'unknown-point' });
  });
});

describe('persistence and watching', () => {
  it('saves a round-trippable snapshot on every change', () => {
    const save = vi.fn();
    const cp = build({ save });
    cp.addFromJoin(A, 'c1');
    expect(save).toHaveBeenCalledTimes(1);

    const restored = build({ initial: save.mock.calls.at(-1)[0] });
    expect(restored.list()[0]).toMatchObject({ url: A, circles: ['c1'], adopted: true });
  });

  it('a failing save does not break the list for this session', () => {
    const cp = build({ save: () => { throw new Error('disk full'); } });
    expect(() => cp.addFromJoin(A, 'c1')).not.toThrow();
    expect(cp.list()).toHaveLength(1);
  });

  it('restores an un-adopted suggestion as un-adopted', () => {
    const cp = build({ initial: { [A]: { source: 'suggested', circles: ['c1'], adopted: false } } });
    expect(cp.list()[0].adopted).toBe(false);
  });

  it('ignores junk in the restored state', () => {
    const cp = build({ initial: { 'not-a-url': { circles: ['c1'] }, [A]: {} } });
    expect(cp.list().map((p) => p.url)).toEqual([A]);
  });

  it('notifies watchers, and unsubscribing stops it', () => {
    const cp = build();
    const seen = vi.fn();
    const off = cp.subscribe(seen);
    cp.addFromJoin(A, 'c1');
    expect(seen).toHaveBeenCalled();

    off();
    seen.mockClear();
    cp.addFromJoin(B, 'c2');
    expect(seen).not.toHaveBeenCalled();
  });

  it('a throwing watcher does not stop the others', () => {
    const cp = build();
    const good = vi.fn();
    cp.subscribe(() => { throw new Error('bad render'); });
    cp.subscribe(good);
    cp.addFromJoin(A, 'c1');
    expect(good).toHaveBeenCalled();
  });
});

describe('one is live, the rest are standby', () => {
  it('the substrate connects to ONE relay, so exactly one point is active', () => {
    // A list showing five points as though all were carrying traffic would be a lie.
    const cp = build();
    cp.addFromJoin(A, 'c1');
    cp.addFromJoin(B, 'c2');
    expect(cp.list().filter((p) => p.active)).toHaveLength(0);

    cp.setActive(A);
    expect(cp.list().find((p) => p.url === A).active).toBe(true);
    expect(cp.list().find((p) => p.url === B).active).toBe(false);
    expect(cp.activeUrl()).toBe(A);
  });

  it('the store DESCRIBES the connection, it does not make one', () => {
    // Setting a point we do not have would let the list claim something the transport disagrees with.
    const cp = build();
    expect(cp.setActive('wss://never.added')).toBeNull();
  });

  it('a STANDBY point still counts as "still reachable" — switching is a reconnect, not a re-join', () => {
    const cp = build();
    cp.addFromJoin(A, 'c1');
    cp.addFromJoin(B, 'c1');
    cp.setActive(A);
    expect(cp.impactOfRemoving(A)).toMatchObject({ losesReachability: [], stillReachable: ['c1'] });
  });

  it('but removing the LIVE point is flagged as its own event', () => {
    // Even when nothing is cut off, the connection drops until another is chosen.
    const cp = build();
    cp.addFromJoin(A, 'c1');
    cp.addFromJoin(B, 'c1');
    cp.setActive(A);
    expect(cp.impactOfRemoving(A).wasActive).toBe(true);
    expect(cp.impactOfRemoving(B).wasActive).toBe(false);
  });

  it('removing the live point clears active rather than leaving a dangling one', () => {
    const cp = build();
    cp.addFromJoin(A, 'c1');
    cp.setActive(A);
    cp.remove(A);
    expect(cp.activeUrl()).toBeNull();
  });
});

describe('migrating the old single-relay setting', () => {
  it('folds the existing url in as a point, and marks it live', () => {
    const cp = build();
    expect(adoptExistingRelay({ relayUrl: A, points: cp })).toEqual({ migrated: true });
    expect(cp.list()[0]).toMatchObject({ url: A, source: POINT_SOURCE.MANUAL });
    expect(cp.activeUrl()).toBe(A);
  });

  it('is idempotent — running it again changes nothing', () => {
    const cp = build();
    adoptExistingRelay({ relayUrl: A, points: cp });
    expect(adoptExistingRelay({ relayUrl: A, points: cp })).toEqual({ migrated: false });
    expect(cp.list()).toHaveLength(1);
  });

  it('marks an ALREADY-KNOWN url live without re-adding it', () => {
    const cp = build();
    cp.addFromJoin(A, 'c1');
    expect(adoptExistingRelay({ relayUrl: A, points: cp })).toEqual({ migrated: false });
    expect(cp.list()[0]).toMatchObject({ source: POINT_SOURCE.JOIN, active: true, circles: ['c1'] });
  });

  it('no relay configured ⇒ nothing to migrate', () => {
    const cp = build();
    expect(adoptExistingRelay({ relayUrl: null, points: cp })).toEqual({ migrated: false });
    expect(cp.list()).toEqual([]);
  });
});

describe('the persistence adapters', () => {
  it('localStorage IO round-trips', () => {
    const mem = new Map();
    const io = localStorageConnectionPointsIo({
      getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v),
    });
    io.save({ [A]: { url: A, source: 'join', circles: ['c1'], adopted: true } });
    expect(io.load()[A]).toMatchObject({ url: A, circles: ['c1'] });
  });

  it('a corrupt or absent store loads as empty rather than throwing', () => {
    const io = localStorageConnectionPointsIo({ getItem: () => 'not json', setItem: () => {} });
    expect(io.load()).toEqual({});
    expect(localStorageConnectionPointsIo(null).load()).toEqual({});
  });

  it('AsyncStorage IO round-trips', async () => {
    const mem = new Map();
    const io = asyncStorageConnectionPointsIo({
      getItem: async (k) => mem.get(k) ?? null, setItem: async (k, v) => { mem.set(k, v); },
    });
    await io.save({ [B]: { url: B, source: 'manual', circles: [], adopted: true } });
    expect((await io.load())[B]).toMatchObject({ url: B });
  });
});

describe('the pod as a connection point (NKN+pod circle, J-NP1/J-NP6)', () => {
  const POD = 'https://pod.example/circles/c1';

  it('a pod-backed circle lists its POD, so "what breaks if I remove this" has an answer', () => {
    const cp = build();
    expect(cp.addPodPoint(POD, 'c1')).toEqual({ ok: true });
    const [p] = cp.list();
    expect(p).toMatchObject({ kind: POINT_KIND.POD, url: POD, circles: ['c1'], adopted: true });
  });

  it('a pod point takes https and a relay point does not — each kind validates its own shape', () => {
    const cp = build();
    expect(cp.addPodPoint('wss://not-a-pod.example', 'c1')).toMatchObject({ ok: false });
    expect(cp.addFromJoin(POD, 'c1')).toMatchObject({ ok: false });          // https is not a relay
    expect(cp.addPodPoint(POD, 'c1')).toEqual({ ok: true });
  });

  it('a pod is NEVER "active" — that is a socket fact, and a pod has no socket', () => {
    // Claiming a pod was standby would be the same lie in the other direction: it is used whenever the
    // circle syncs. The flag is relay-only; renderers skip the line for pods.
    const cp = build();
    cp.addPodPoint(POD, 'c1');
    expect(cp.setActive(POD)).toBeNull();
    expect(cp.list()[0].active).toBe(false);

    cp.addFromJoin(A, 'c2');
    expect(cp.setActive(A)).toBe(A);
  });

  it('J-NP6: removing the pod of a pod-only circle names it CUT OFF', () => {
    // A pod-backed circle has no relay to fall back to; the impact calculation must not assume every
    // circle has an alternative.
    const cp = build();
    cp.addPodPoint(POD, 'pod-only-circle');
    expect(cp.impactOfRemoving(POD)).toMatchObject({ losesReachability: ['pod-only-circle'] });
  });

  it('a pod point survives a save/restore round-trip with its kind', () => {
    const save = vi.fn();
    const cp = build({ save });
    cp.addPodPoint(POD, 'c1');
    const restored = build({ initial: save.mock.calls.at(-1)[0] });
    expect(restored.list()[0]).toMatchObject({ kind: POINT_KIND.POD, url: POD });
  });
});

// ── Rule 1 on a JOIN — the shared recorder both shells call ─────────────────────────────────────────
describe('recordJoinedCirclePoints', () => {
  const POD = 'https://pod.example/circles/c1';

  it('records the pod AND the relay the invite carried', () => {
    const cp = build();
    const out = recordJoinedCirclePoints({ store: cp, invite: { podBacked: true, podUrl: POD, relayUrl: A }, circleId: 'c1' });
    expect(out.recorded.sort()).toEqual(['pod', 'relay']);
    expect(cp.list().map((p) => p.url).sort()).toEqual([POD, A].sort());
    expect(cp.circlesFor(A)).toContain('c1');       // G13 scoping reads this mapping
    expect(cp.circlesFor(POD)).toContain('c1');
  });

  it('relay-only invite records just the relay; pod fields absent add nothing', () => {
    const cp = build();
    const out = recordJoinedCirclePoints({ store: cp, invite: { relayUrl: B }, circleId: 'c2' });
    expect(out.recorded).toEqual(['relay']);
    expect(cp.list()).toHaveLength(1);
  });

  it('a podUrl WITHOUT podBacked is not recorded (the invite contract: url only ever beside the flag)', () => {
    const cp = build();
    const out = recordJoinedCirclePoints({ store: cp, invite: { podUrl: POD }, circleId: 'c3' });
    expect(out.recorded).toEqual([]);
    expect(cp.list()).toHaveLength(0);
  });

  it('malformed urls + a missing store are safe no-ops (a join must never break on this)', () => {
    const cp = build();
    expect(recordJoinedCirclePoints({ store: cp, invite: { relayUrl: 'http://not-a-socket', podBacked: true, podUrl: 'ftp://x' }, circleId: 'c4' }).recorded).toEqual([]);
    expect(recordJoinedCirclePoints({ invite: { relayUrl: A }, circleId: 'c4' }).recorded).toEqual([]);
    expect(recordJoinedCirclePoints({ store: cp, circleId: 'c4' }).recorded).toEqual([]);
  });
});
