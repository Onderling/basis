/**
 * Last-admin caretaker appointment (Connectivity Phase 4 §5, L4).
 *
 * The one property that matters: the pick is DETERMINISTIC and seeded by the shared
 * departure-event hash, so every replica lands on the same caretaker with no coordination
 * (a locally-rolled random would diverge and the fix would itself be a fork). Plus the
 * mechanics: next-in-line skips the unreachable, and needsCaretaker fires only when no
 * admin remains. Fixtures pinned from a live run so the seed-sensitivity check can't flake.
 */
import { describe, it, expect } from 'vitest';
import { appointCaretaker, caretakerOrder, needsCaretaker } from '../../src/v2/governanceCaretaker.js';

const CANDS = [
  { ref: 'm0', address: 'addr-alpha' },
  { ref: 'm1', address: 'addr-bravo' },
  { ref: 'm2', address: 'addr-charlie' },
  { ref: 'm3', address: 'addr-delta' },
];

describe('needsCaretaker', () => {
  it('true only when the post-departure roster has members but NO admin', () => {
    expect(needsCaretaker([{ ref: 'm0', role: 'member' }, { ref: 'm1', role: 'member' }])).toBe(true);
    expect(needsCaretaker([{ ref: 'm0', role: 'member' }, { ref: 'a', role: 'admin' }])).toBe(false); // an admin remains
    expect(needsCaretaker([])).toBe(false);   // empty circle needs no caretaker
  });
});

describe('appointCaretaker — deterministic, seeded by the departure event', () => {
  it('is stable: the same inputs always yield the same caretaker (every replica agrees)', () => {
    const a = appointCaretaker({ candidates: CANDS, departingHash: 'event-hash-1' });
    const b = appointCaretaker({ candidates: [...CANDS].reverse(), departingHash: 'event-hash-1' }); // input order irrelevant
    expect(a.ref).toBe('m3');
    expect(b.ref).toBe('m3');
  });

  it('the departure hash actually reorders the pick (the shared entropy is used)', () => {
    expect(appointCaretaker({ candidates: CANDS, departingHash: 'event-hash-1' }).ref).toBe('m3');
    expect(appointCaretaker({ candidates: CANDS, departingHash: 'event-hash-2' }).ref).toBe('m2');
  });

  it('caretakerOrder is a stable permutation of the candidates', () => {
    const order = caretakerOrder({ candidates: CANDS, departingHash: 'event-hash-1' }).map((c) => c.ref);
    expect(order).toEqual(['m3', 'm1', 'm0', 'm2']);
    expect([...order].sort()).toEqual(CANDS.map((c) => c.ref).sort()); // no member lost or duplicated
  });

  it('skips the unreachable → next-in-line (by ref OR address)', () => {
    const order = caretakerOrder({ candidates: CANDS, departingHash: 'event-hash-1' }).map((c) => c.ref);
    const next = appointCaretaker({ candidates: CANDS, departingHash: 'event-hash-1', unreachable: ['m3'] });
    expect(next.ref).toBe(order[1]);   // 'm1'
    // skipping by address works too — the refinement still knows both spellings
    const next2 = appointCaretaker({ candidates: CANDS, departingHash: 'event-hash-1', unreachable: new Set(['addr-delta', 'addr-bravo']) });
    expect(next2.ref).toBe('m0');       // m3 + m1 skipped → third in line
  });

  it('every candidate unreachable → still returns the deterministic first pick (never re-strand)', () => {
    const all = new Set(CANDS.map((c) => c.ref));
    expect(appointCaretaker({ candidates: CANDS, departingHash: 'event-hash-1', unreachable: all }).ref).toBe('m3');
  });

  it('no valid candidates → null; malformed candidates are ignored', () => {
    expect(appointCaretaker({ candidates: [], departingHash: 'x' })).toBeNull();
    // A candidate with no ADDRESS is now valid: the order keys on the REF, because that is what the
    // fold — which actually appoints — has. Only a ref-less candidate is malformed.
    expect(appointCaretaker({ candidates: [{ ref: 'no-addr' }, null], departingHash: 'x' })?.ref).toBe('no-addr');
    expect(appointCaretaker({ candidates: [null, { address: 'no-ref' }], departingHash: 'x' })).toBeNull();
  });
});
