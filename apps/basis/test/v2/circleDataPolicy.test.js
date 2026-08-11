/**
 * C9 — circleDataPolicy: the ONE circle data-policy vocabulary + single
 * mapping. These tests prove that each data-policy value resolves to the
 * correct send-path `dataMove` branch AND the correct PseudoPod store `mode`
 * (and catch-up strategy), that the result is behaviour-identical to the
 * derivations it replaces, and that legacy `pod`/`mode` values still map.
 *
 * Pure JS; no DOM/RN. Deterministic.
 */
import { describe, it, expect } from 'vitest';
import {
  CIRCLE_DATA_POLICIES,
  DATA_MOVE_BRANCHES,
  STORE_MODES,
  DATA_POLICY_MAP,
  LEGACY_MODE_TO_POLICY,
  normalizeDataPolicy,
  resolveCircleDataPolicy,
  circleDataMove,
  circleStoreMode,
  circleCatchUpStrategy,
  circleHasPod,
} from '../../src/v2/circleDataPolicy.js';
import { PSEUDO_POD_MODES } from '@onderling/pseudo-pod';
import { CIRCLE_POLICY_ENUMS } from '../../src/v2/circlePolicy.js';

describe('circleDataPolicy — the one vocabulary', () => {
  it('sources the canonical values from circlePolicy (no drift)', () => {
    expect(CIRCLE_DATA_POLICIES).toEqual([...CIRCLE_POLICY_ENUMS.pod]);
    expect(CIRCLE_DATA_POLICIES).toEqual(['none', 'shared', 'personal', 'hybrid']);
  });

  it('sources the store modes from @onderling/pseudo-pod (no drift)', () => {
    expect(STORE_MODES).toBe(PSEUDO_POD_MODES);
    expect(STORE_MODES).toEqual(['standalone', 'replication-ring', 'cache']);
  });

  it('lists the phase-2 dataMove branches', () => {
    expect(DATA_MOVE_BRANCHES).toEqual(['fan-out-full', 'pod-signal', 'pod-only', 'ref+blob']);
  });
});

// The behaviour-identical mapping, asserted setup-by-setup. Each row states
// the effective dataMove branch AND the store mode a circle must resolve to.
const EXPECTED = [
  { pod: 'none',     dataMove: 'fan-out-full', storeMode: 'standalone', catchUp: 'peer',   hasPod: false },
  { pod: 'shared',   dataMove: 'pod-signal',   storeMode: 'cache',      catchUp: 'pod',    hasPod: true  },
  { pod: 'personal', dataMove: 'pod-only',     storeMode: 'cache',      catchUp: 'peer',   hasPod: true  },
  { pod: 'hybrid',   dataMove: 'pod-signal',   storeMode: 'cache',      catchUp: 'hybrid', hasPod: true  },
];

describe('resolveCircleDataPolicy — one enum → dataMove + store mode', () => {
  for (const row of EXPECTED) {
    it(`pod='${row.pod}' → dataMove='${row.dataMove}', storeMode='${row.storeMode}', catchUp='${row.catchUp}'`, () => {
      const r = resolveCircleDataPolicy({ pod: row.pod });
      expect(r).toEqual({
        policy:    row.pod,
        dataMove:  row.dataMove,
        storeMode: row.storeMode,
        catchUp:   row.catchUp,
        hasPod:    row.hasPod,
      });
    });

    it(`pod='${row.pod}' — the thin accessors agree with the resolver`, () => {
      expect(circleDataMove({ pod: row.pod })).toBe(row.dataMove);
      expect(circleStoreMode({ pod: row.pod })).toBe(row.storeMode);
      expect(circleCatchUpStrategy({ pod: row.pod })).toBe(row.catchUp);
      expect(circleHasPod({ pod: row.pod })).toBe(row.hasPod);
    });
  }

  it('every dataMove/storeMode it emits is a declared member of the vocab', () => {
    for (const pod of CIRCLE_DATA_POLICIES) {
      const r = resolveCircleDataPolicy({ pod });
      expect(DATA_MOVE_BRANCHES).toContain(r.dataMove);
      expect(STORE_MODES).toContain(r.storeMode);
    }
  });

  it('accepts a bare policy string as well as a { pod } object', () => {
    expect(resolveCircleDataPolicy('shared')).toEqual(resolveCircleDataPolicy({ pod: 'shared' }));
  });

  it('the DATA_POLICY_MAP is frozen (single source, not mutable)', () => {
    expect(Object.isFrozen(DATA_POLICY_MAP)).toBe(true);
    expect(Object.isFrozen(DATA_POLICY_MAP.none)).toBe(true);
  });
});

describe('back-compat — legacy pod + PseudoPod mode values still map', () => {
  it('canonical pod values pass through unchanged', () => {
    for (const pod of CIRCLE_DATA_POLICIES) {
      expect(normalizeDataPolicy(pod)).toBe(pod);
      expect(normalizeDataPolicy({ pod })).toBe(pod);
    }
  });

  it('legacy store-mode strings fold into the canonical vocab', () => {
    // standalone / replication-ring are no-pod postures; cache is the
    // pod-backed default (shared). Documented lossiness: cache cannot
    // uniquely invert to personal/hybrid.
    expect(normalizeDataPolicy('standalone')).toBe('none');
    expect(normalizeDataPolicy('replication-ring')).toBe('none');
    expect(normalizeDataPolicy('cache')).toBe('shared');
    expect(LEGACY_MODE_TO_POLICY).toEqual({
      standalone: 'none', 'replication-ring': 'none', cache: 'shared',
    });
  });

  it('a legacy standalone store resolves to the same effective posture as pod=none', () => {
    expect(resolveCircleDataPolicy('standalone')).toEqual(resolveCircleDataPolicy({ pod: 'none' }));
  });

  it('unknown / missing / null input falls back to the no-pod posture', () => {
    for (const bad of ['someFutureAxis', '', undefined, null, {}, 42]) {
      const r = resolveCircleDataPolicy(bad);
      expect(r.policy).toBe('none');
      expect(r.dataMove).toBe('fan-out-full');
      expect(r.storeMode).toBe('standalone');
      expect(r.hasPod).toBe(false);
    }
  });
});
