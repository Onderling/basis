/**
 * A grant can name the PERSON its screen acts as (a household bot grants a screen for one of its people): every token
 * carries `actingAs = <that person>`, signed by the issuer, and the grants-lane entry keeps the person too — for the
 * person's list of screens, for audit, and so that revoking the person can revoke their screens. A grant that names
 * nobody is unchanged: its tokens act as the issuer itself (a person's own screen).
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, CapabilityToken } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createSurfaceGrants } from '../../src/v2/surfaceGrants.js';

function fakeRail() {
  const bodies = []; let n = 0;
  return {
    bodies,
    async append(_scope, { kind, subject, payload }) { const statement = { kind, subject, payload, hash: `h${n++}`, parentHash: bodies.at(-1)?.hash ?? null, deps: [] }; bodies.push(statement); return { statement }; },
    async readVerifiedBodies() { return { bodies: [...bodies] }; },
  };
}

describe('a grant names the person its screen acts as', () => {
  it('every token says actingAs = the person; the entry keeps the person; without one, the issuer as before', async () => {
    const identity = await AgentIdentity.generate(new VaultMemory());
    const g = createSurfaceGrants({ identity, rail: fakeRail() });
    await g.hydrate();
    const view = (await AgentIdentity.generate(new VaultMemory())).pubKey;
    const r = await g.grant({ viewPubKey: view, ops: ['lists.addToList', 'lists.listEntries'], label: 'scherm', actingAs: 'telegram:1' });
    for (const t of r.tokens) expect(CapabilityToken.fromJSON(t).constraints.actingAs).toBe('telegram:1');
    expect(g.list().find((e) => e.viewPubKey === view)).toMatchObject({ actingAs: 'telegram:1', ops: ['lists.addToList', 'lists.listEntries'] });

    const own = (await AgentIdentity.generate(new VaultMemory())).pubKey;
    const r2 = await g.grant({ viewPubKey: own, ops: ['lists.addToList'] });
    expect(CapabilityToken.fromJSON(r2.tokens[0]).constraints.actingAs).toBe(identity.pubKey);
    expect(g.list().find((e) => e.viewPubKey === own).actingAs ?? null).toBeNull();
  });
});
