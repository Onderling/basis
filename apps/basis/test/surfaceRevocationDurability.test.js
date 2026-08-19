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
import { actAsConnection, trustForGrant } from './support/actAsConnection.js';
import { CONNECTION_MANIFESTS } from '../src/v2/connectionManifests.js';

describe('surface revocation durability', () => {
  it('a revoked view must STILL be refused after the agent reboots on the same identity', async () => {
    // One identity across both boots — the ceremony pattern: share the vaults, so the second
    // boot is the SAME owner, exactly as a real app restart is.
    const ownerRootVault = new VaultMemory();
    const chatVault = new VaultMemory();
    const settings = memoryDataSource();
    const boot = () => createRealHouseholdAgent({
      a2aManifests: CONNECTION_MANIFESTS,   // the shells pass this; a walk that acts must too
      seedHousehold: false, ownerRootVault, chatVault, settingsDataSource: settings,
    });

    const view = await AgentIdentity.generate(new VaultMemory());
    const A = await boot();

    const grant = await A.callSkill('household', 'grantSurface', {
      viewPubKey: view.pubKey, ops: ['params.set-param'], label: 'tablet',
    });
    expect(grant.ok).toBe(true);
    const token = grant.tokens[0];

    // Acting is the ordinary A2A path now: present the token, the gate decides. Revocation is what
    // this walk is about, so it asserts the CODE — a revoked token must fail as a revoked token, not
    // as some generic denial that a typo would also produce.
    const actThrough = async (agent) => {
      await trustForGrant(agent, view.pubKey);
      return actAsConnection(agent, {
        callerPubKey: view.pubKey, opId: 'params.set-param',
        args: { key: 'display.theme', value: 'dark' }, token: token?.toJSON?.() ?? token,
      });
    };

    expect((await actThrough(A)).ok, 'a fresh grant could not act').toBe(true);
    const rev = await A.callSkill('household', 'revokeSurface', { viewPubKey: view.pubKey });
    expect(rev).toMatchObject({ ok: true, revoked: true });
    expect((await actThrough(A)).code, 'unpairing did not stop the connection').toBe('INVALID_TOKEN');

    // THE REBOOT. Same owner, same identity, same stored settings — and the view still holds
    // the token blob it was given. Unpairing must outlive the process.
    const B = await boot();
    await B.surfaceGrantsReady();          // the door refuses until the registry lands
    const afterReboot = await actThrough(B);
    expect(afterReboot.code, 'a revoked connection acted again after a reboot').toBe('INVALID_TOKEN');
  }, 60_000);
});
