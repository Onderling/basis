/**
 * The circle storage postures — one vocabulary, and the guard the shared-vocabulary convention asks
 * for: a test asserting its EXACT membership, so adding a posture is a deliberate act and a second
 * vocabulary for the same concept shows up as two tests describing one thing.
 *
 * The history this pins: the set was written four times, in two vocabularies that disagreed
 * (`no-pod|centralised|decentralised` against `none|shared|personal`), and one of the four was a
 * TRANSLATION TABLE between the other two — which was the proof they were identical, sitting in the
 * repo the whole time the question was open.
 */
import { describe, it, expect } from 'vitest';
import {
  CIRCLE_STORAGE_POSTURES,
  CIRCLE_STORAGE_POSTURE_NAMES,
  DEFAULT_CIRCLE_STORAGE_POSTURE,
  isCircleStoragePosture,
  normaliseCircleStoragePosture,
  posturePodUriRequired,
} from '../src/circleStoragePosture.js';

describe('circle storage postures — exact membership', () => {
  it('is exactly these four, in this order', () => {
    expect(CIRCLE_STORAGE_POSTURE_NAMES).toEqual(['none', 'shared', 'personal', 'hybrid']);
  });

  it('none of the retired words survives anywhere in the vocabulary', () => {
    // The rename is the point: a leftover would mean two words for one posture again.
    for (const retired of ['no-pod', 'centralised', 'decentralised']) {
      expect(CIRCLE_STORAGE_POSTURE_NAMES).not.toContain(retired);
      expect(isCircleStoragePosture(retired)).toBe(false);
    }
  });

  it('the table is frozen through, not just at the top', () => {
    expect(Object.isFrozen(CIRCLE_STORAGE_POSTURES)).toBe(true);
    for (const row of Object.values(CIRCLE_STORAGE_POSTURES)) expect(Object.isFrozen(row)).toBe(true);
  });
});

describe('what actually differs between the postures', () => {
  it('only a circle-SHARED pod needs to say which pod', () => {
    // This is the whole of what the old vocabulary's validation encoded.
    expect(posturePodUriRequired('shared')).toBe(true);
    expect(posturePodUriRequired('hybrid')).toBe(true);
    expect(posturePodUriRequired('personal')).toBe(false);   // each member resolves their own
    expect(posturePodUriRequired('none')).toBe(false);
  });

  it('`none` is the only posture without a pod', () => {
    expect(CIRCLE_STORAGE_POSTURES.none.hasPod).toBe(false);
    for (const p of ['shared', 'personal', 'hybrid']) {
      expect(CIRCLE_STORAGE_POSTURES[p].hasPod, p).toBe(true);
    }
  });

  it('`personal` is a posture in its own right, not a synonym for `none`', () => {
    // Frits, 2026-08-27, correcting a proposal of mine that would have collapsed it: a pod circle
    // that fans NOTHING is a real posture — no relay traffic, so no relay-visible trace of who talks
    // to whom. It differs from `none` on the axis that matters here.
    expect(CIRCLE_STORAGE_POSTURES.personal).not.toEqual(CIRCLE_STORAGE_POSTURES.none);
    expect(CIRCLE_STORAGE_POSTURES.personal.hasPod).toBe(true);
  });
});

describe('coercion refuses to invent a pod', () => {
  it('an unknown or missing posture resolves to `none`', () => {
    // Assuming a pod means writing content somewhere nobody agreed to, so the fallback is downward.
    for (const bad of ['bogus', 'centralised', undefined, null, 42, {}, '']) {
      expect(normaliseCircleStoragePosture(bad)).toBe('none');
    }
    expect(DEFAULT_CIRCLE_STORAGE_POSTURE).toBe('none');
  });

  it('a real posture passes through untouched', () => {
    for (const p of CIRCLE_STORAGE_POSTURE_NAMES) expect(normaliseCircleStoragePosture(p)).toBe(p);
  });
});
