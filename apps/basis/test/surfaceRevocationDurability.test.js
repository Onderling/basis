/**
 * PROBE — does a revoked surface stay revoked across a reboot?
 *
 * The acting door refuses on three token facts (signature/expiry/agent binding, the trusted
 * issuer, and the revocation set) — and the revocation set is the ONLY one of the three that
 * depends on this process's memory. The token itself is signed by the device's stable identity,
 * so it keeps verifying forever. If the registry does not survive a restart, a view the owner
 * unpaired starts acting again the next time the app boots, holding the very blob they revoked.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { memoryDataSource } from '@onderling/item-store';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { makeSurfaceActClient } from '../src/v2/surfaceRail.js';

describe('surface revocation durability', () => {
  it('a revoked view must STILL be refused after the agent reboots on the same identity', async () => {
    // One identity across both boots — the ceremony pattern: share the vaults, so the second
    // boot is the SAME owner, exactly as a real app restart is.
    const ownerRootVault = new VaultMemory();
    const chatVault = new VaultMemory();
    const settings = memoryDataSource();
    const boot = () => createRealHouseholdAgent({
      seedHousehold: false, ownerRootVault, chatVault, settingsDataSource: settings,
    });

    const view = await AgentIdentity.generate(new VaultMemory());
    const A = await boot();

    const grant = await A.callSkill('household', 'grantSurface', {
      viewPubKey: view.pubKey, ops: ['params.set-param'], label: 'tablet',
    });
    expect(grant.ok).toBe(true);
    const token = grant.tokens[0];

    const actThrough = async (agent) => {
      let client;
      const door = agent.makeSurfaceActDoor({ reply: (p) => client.handleResult(p) });
      client = makeSurfaceActClient({ identity: view, send: (p) => door('wire', p) });
      return client.act({ group: 'params', op: 'set-param', args: { key: 'display.theme', value: 'dark' }, token });
    };

    expect((await actThrough(A)).ok).toBe(true);                       // paired: acts
    const rev = await A.callSkill('household', 'revokeSurface', { viewPubKey: view.pubKey });
    expect(rev).toMatchObject({ ok: true, revoked: true });
    expect(await actThrough(A)).toEqual({ ok: false, code: 'revoked' }); // unpaired: refused

    // THE REBOOT. Same owner, same identity, same stored settings — and the view still holds
    // the token blob it was given. Unpairing must outlive the process.
    const B = await boot();
    await B.surfaceGrantsReady();          // the door refuses until the registry lands
    const afterReboot = await actThrough(B);
    expect(afterReboot, 'a revoked surface acted again after a reboot').toEqual({ ok: false, code: 'revoked' });
  }, 60_000);
});
