/**
 * Connection points (Nearby step I, §7).
 *
 * The only question anyone actually asks about a relay is **"if I remove this, what breaks?"** — so most of
 * these tests are about answering it truthfully, and about the distinction that makes the answer useful:
 * a circle with a second point is inconvenienced; a circle left with none is cut off.
 */
import { describe, it, expect, vi } from 'vitest';
import { createConnectionPoints, POINT_SOURCE } from '../../src/v2/connectionPoints.js';

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
