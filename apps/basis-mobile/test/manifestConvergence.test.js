/**
 * manifest convergence — defensive regression tests.
 *
 * Pins canonical shapes that span every app's manifest, so the next
 * time someone adds an op with `state: 'open'` (string) we catch it
 * at test time instead of when a list bubble silently fails to match
 * an appliesTo gate in renderChat.
 *
 * Lives in basis-mobile/test/ rather than packages/app-manifest
 * because the merged catalogue already pulls every consumed manifest
 * through composeManifests + buildManifestsByOrigin — exactly the
 * union the dispatcher sees at runtime.  No need to import each app
 * individually here.
 */
import { describe, it, expect } from 'vitest';
import {
  composeManifests, buildManifestsByOrigin,
} from '../src/core/composeManifests.js';

/** Walk every op in every manifest, yielding { appOrigin, opId, op }. */
function* allOps() {
  const manifests = buildManifestsByOrigin();
  for (const [appOrigin, manifest] of Object.entries(manifests)) {
    for (const op of manifest.operations ?? []) {
      yield { appOrigin, opId: op.id, op };
    }
  }
}

describe('#240 manifest convergence — canonical shapes', () => {
  it('every appliesTo.state is an array (never a bare string)', () => {
    const violations = [];
    for (const { appOrigin, opId, op } of allOps()) {
      const state = op.appliesTo?.state;
      if (state === undefined) continue;          // optional
      if (!Array.isArray(state)) {
        violations.push(
          `${appOrigin}.${opId} → appliesTo.state is ${JSON.stringify(state)} (must be array)`,
        );
      }
    }
    // Friendly aggregate failure: lists ALL violations at once so
    // the next contributor sees the whole picture, not just the
    // first one.
    expect(violations).toEqual([]);
  });

  it('every appliesTo.state array contains only strings (lifecycle state names)', () => {
    const violations = [];
    for (const { appOrigin, opId, op } of allOps()) {
      const state = op.appliesTo?.state;
      if (!Array.isArray(state)) continue;
      for (const [i, s] of state.entries()) {
        if (typeof s !== 'string' || s.length === 0) {
          violations.push(
            `${appOrigin}.${opId}.appliesTo.state[${i}] = ${JSON.stringify(s)}`,
          );
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('every appliesTo.type is either a non-empty string OR an array of strings', () => {
    // F-SP3-a (locked 2026-05-20): renderChat tolerates both shapes
    // because some ops legitimately apply to multiple item types
    // (e.g. stoop.startDm targets both 'contact' AND 'member' rows).
    // This test is more lax than the appliesTo.state one above
    // because we DON'T force a canonical here — the convention is:
    //   - single type: bare string (`type: 'task'`)
    //   - multi-type:  array (`type: ['contact', 'member']`)
    const violations = [];
    for (const { appOrigin, opId, op } of allOps()) {
      const type = op.appliesTo?.type;
      if (type === undefined) continue;           // optional
      const ok = (typeof type === 'string' && type.length > 0) ||
                 (Array.isArray(type) && type.length > 0 &&
                  type.every((t) => typeof t === 'string' && t.length > 0));
      if (!ok) {
        violations.push(
          `${appOrigin}.${opId} → appliesTo.type is ${JSON.stringify(type)}`,
        );
      }
    }
    expect(violations).toEqual([]);
  });

  it('the composed catalogue still validates clean (no new warnings from this slice)', () => {
    // The merged catalogue should not surface any UNEXPECTED warnings.  Benign
    // collision warnings are the documented first-mount-wins policy:
    //   - op-id collisions (e.g. startDm in both basis + stoop) →
    //     prefixed as `<app>/<op>`.
    //   - slash collisions (Part G 2026-06-17: the REAL household shares
    //     generic commands like `/help`, `/claim`, `/done` with basis /
    //     tasks; first-mount keeps the command).  These are policy, not bugs.
    const catalogue  = composeManifests();
    const benign = /(op-id|slash) collision: ".+" (also declared|declared) by/;
    const unexpected = (catalogue.warnings ?? []).filter((w) => !benign.test(w));
    expect(unexpected).toEqual([]);
  });
});
