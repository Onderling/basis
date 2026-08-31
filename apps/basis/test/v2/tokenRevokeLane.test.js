/**
 * token-revoke on the grants lane — the cross-device half of an issuer-side revoke.
 *
 * A task grant (or any issuer-side token) revoked on one device must stop verifying at the
 * owner's OTHER devices too. The device-local managers already survive a restart; what carries
 * the revoke BETWEEN devices is a `token-revoke` statement on the grants lane: appended by
 * `surfaceGrants.revokeTokens`, fanned like every grants statement, folded into the one
 * revoked-id set the dispatch door consults.
 *
 * The rail here is a minimal fake ({append, readVerifiedBodies}) — the real rail's signing,
 * verify-on-ingest and device-set binding are the grants-lane journeys' ground, and the kind
 * admission is asserted against the REAL manifest-derived kind list below.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createSurfaceGrants } from '../../src/v2/surfaceGrants.js';
import { GRANTS_RAIL_KINDS } from '../../src/v2/grantsRail.js';

/** A lane the fold can read and the writer can append to — statements land in order, hashed. */
function fakeRail() {
  const bodies = [];
  let n = 0;
  return {
    bodies,
    async append(_scope, { kind, subject, payload }) {
      const statement = { kind, subject, payload, hash: `h${n++}`, parentHash: bodies.at(-1)?.hash ?? null, deps: [] };
      bodies.push(statement);
      return { statement };
    },
    async readVerifiedBodies() { return { bodies: [...bodies] }; },
  };
}

async function makeGrants(rail, extra = {}) {
  const identity = await AgentIdentity.generate(new VaultMemory());
  const g = createSurfaceGrants({ identity, rail, ...extra });
  await g.hydrate();
  return g;
}

describe('token-revoke — the grants lane carries issuer-side token cancellations', () => {
  it('the real rail admits the kind (declared in the grants manifest)', () => {
    expect(GRANTS_RAIL_KINDS).toContain('token-revoke');
  });

  it('revokeTokens appends, folds, and the door refuses the named ids', async () => {
    const rail = fakeRail();
    const g = await makeGrants(rail);

    expect(await g.isRevoked('tok-1')).toBe(false);
    expect(await g.revokeTokens(['tok-1', 'tok-2'], { reason: 'task-grant' })).toBe(true);

    expect(await g.isRevoked('tok-1')).toBe(true);
    expect(await g.isRevoked('tok-2')).toBe(true);
    expect(await g.isRevoked('tok-other')).toBe(false);
    expect(rail.bodies.at(-1)).toMatchObject({ kind: 'token-revoke', payload: { tokenIds: ['tok-1', 'tok-2'], reason: 'task-grant' } });
  });

  it('nothing to revoke, nothing appended — no empty statements on the lane', async () => {
    const rail = fakeRail();
    const g = await makeGrants(rail);
    expect(await g.revokeTokens([])).toBe(false);
    expect(await g.revokeTokens([null, 42])).toBe(false);
    expect(rail.bodies.length).toBe(0);
  });

  it("a sibling device's statement binds at THIS door after a refold — the fan's receiving half", async () => {
    // Two registries over the SAME lane content model the owner's two devices after the fan
    // (or catch-up) landed the statement; the receiver refolds, exactly as makeGrantsPeerHandler does.
    const rail = fakeRail();
    const deviceA = await makeGrants(rail);
    const deviceB = await makeGrants(rail);

    expect(await deviceB.isRevoked('tok-x')).toBe(false);
    await deviceA.revokeTokens(['tok-x']);
    await deviceB.recompute();
    expect(await deviceB.isRevoked('tok-x')).toBe(true);
  });

  it('the appended statement reaches the fan, so siblings hear it live', async () => {
    const rail = fakeRail();
    const fanned = [];
    const g = await makeGrants(rail, { fan: (s) => fanned.push(s) });
    await g.revokeTokens(['tok-live']);
    expect(fanned.length).toBe(1);
    expect(fanned[0]).toMatchObject({ kind: 'token-revoke' });
  });
});
