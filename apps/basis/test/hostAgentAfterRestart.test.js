/**
 * After a restart the host agent still answers: a second boot over the SAME persisted stores (the phone's relaunch)
 * handles `revealOwnerPhrase` and the agents agent's calls, as the first boot did. Walked on an emulator 2026-10-09:
 * every call after a force-stop + relaunch went unanswered (30 s timeout), so creating a circle hung.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createRealHouseholdAgent } from '../src/core/agent/realAgent.js';
import { PERSON_NODE_STORE_OPTS } from '../src/v2/personNodeStore.js';

describe('the host agent across a restart', () => {
  it('answers on the second boot over the same stores', async () => {
    const vaults = { ownerRootVault: new VaultMemory(), chatVault: new VaultMemory(), hostVault: new VaultMemory() };
    const boot = () => createRealHouseholdAgent({ seedHousehold: false, ...vaults, ...PERSON_NODE_STORE_OPTS });
    const first = await boot();
    const p1 = await first.callSkill('household', 'revealOwnerPhrase', {});
    expect(p1?.mnemonic, JSON.stringify(p1)).toBeTruthy();
    await first.stop?.();
    const second = await boot();
    const t0 = Date.now();
    const p2 = await second.callSkill('household', 'revealOwnerPhrase', {});
    expect(p2?.mnemonic, JSON.stringify(p2)).toBe(p1.mnemonic);
    expect(Date.now() - t0).toBeLessThan(5000);
    const agents = await second.callSkill('agents', 'listAgents', {}).catch((e) => ({ error: e?.message }));
    expect(agents?.error, JSON.stringify(agents)).toBeFalsy();
    await second.stop?.();
  }, 60_000);
});
