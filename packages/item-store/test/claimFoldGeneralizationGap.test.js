import { describe, it, expect } from 'vitest';
import { reconcileClaim, CLAIM_FIELDS } from '../src/causalMerge.js';
import { createResolutionRegistry, defaultResolutionRegistry, RESOLUTION } from '../src/resolutionPolicy.js';

// #32 acceptance / gap-documentation test.
//
// The claim channel (first-wins / immutable-once-set) is dispatched per-type by resolutionPolicy.hasChannel,
// which is already pluggable. But the FOLD BODY (`reconcileClaim` in causalMerge.js) reads a single global,
// TASK-shaped field vocabulary (`CLAIM_FIELDS` = assignee/claimedAt/confirmed…). So a non-task type that
// declares a claim policy (e.g. an offer with `reservedBy`/`reservedAt`) routes into `reconcileClaim`, which
// finds none of its fields, returns null, and the merge SILENTLY falls through to content-LWW — the declared
// claim channel does nothing. This test PINS that current behaviour so the fix (a per-item-type claim
// descriptor) has a red/green target: when the fold is descriptor-driven, the first `describe` block flips.
describe('#32 — the claim fold is TASK-hardcoded (documents the gap)', () => {
  it('CLAIM_FIELDS is the task vocabulary only — no per-type field-set exists yet', () => {
    expect(CLAIM_FIELDS).toContain('assignee');
    expect(CLAIM_FIELDS).toContain('claimedAt');
    // A non-task claim key (an offer reservation) is NOT in the global cluster — the coupling to lift.
    expect(CLAIM_FIELDS).not.toContain('reservedBy');
    expect(CLAIM_FIELDS).not.toContain('reservedAt');
  });

  it('SILENT NO-OP: two concurrent offer reservations do not resolve — the fold ignores non-task claim fields', () => {
    // Two devices each "reserve" the same offer, with different reservers, off the same base (concurrent).
    const local    = { type: 'offer', text: 'ladder', reservedBy: 'anna', reservedAt: 1000 };
    const incoming  = { type: 'offer', text: 'ladder', reservedBy: 'bram', reservedAt: 2000 };
    // A working claim channel would pick a deterministic first-come winner (anna, earliest). Today it returns
    // null: neither carries a TASK claim cluster, so there is nothing to overlay → the caller falls to LWW.
    expect(reconcileClaim(local, incoming)).toBeNull();
    // ↑ When #32 lands (descriptor-driven fold), this should instead return a claim overlay naming the
    //   first-come reserver. Flip this assertion then.
  });

  it('CONTRAST: a task-shaped claim DOES resolve first-come today (the vocabulary the fold understands)', () => {
    const local    = { type: 'task', assignee: 'anna', claimedAt: 1000 };
    const incoming  = { type: 'task', assignee: 'bram', claimedAt: 2000 };
    const winner = reconcileClaim(local, incoming);
    expect(winner).not.toBeNull();
    expect(winner.assignee).toBe('anna');   // earliest claimedAt wins (first-come)
  });
});

describe('#32 loud-guard — a claim the fold cannot resolve fails at declare(), not silently', () => {
  it('THROWS when claim is declared on a non-task field (the silent no-op is now loud)', () => {
    const r = createResolutionRegistry();
    expect(() => r.declare('offer', 'reservedBy', RESOLUTION.CLAIM)).toThrowError(/claim fold only resolves/i);
  });

  it('ALLOWS claim on a task-vocabulary field, and other channels on any field', () => {
    const r = createResolutionRegistry();
    expect(() => r.declare('task', 'assignee', RESOLUTION.CLAIM)).not.toThrow();
    expect(() => r.declare('offer', 'reservedBy', RESOLUTION.CONTENT)).not.toThrow();   // content/spine unrestricted
    expect(() => r.declare('offer', 'text', RESOLUTION.CONTENT)).not.toThrow();
  });

  it('the default registry (task claim cluster) still builds cleanly under the guard', () => {
    expect(() => defaultResolutionRegistry()).not.toThrow();
  });
});
