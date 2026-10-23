/**
 * The chat agent ADOPTS its in-process agents instead of greeting them.
 *
 * Measured on a phone (2026-10-23): the five sealed hellos from the chat agent to the host, household, tasks, pinboard
 * and folio agents — each signed, encrypted, verified and decrypted in pure JS — cost ~0.9 s of boot, and proved
 * nothing: both ends are objects in one process. The boot now sends none of them; the keys are bound from the objects
 * (SecurityLayer.adoptInProcessPeer), calls still pass the gate, and those keys are not among the bindings a device
 * hands its sibling devices.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { InternalTransport } from '@onderling/core';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('the boot adopts its in-process agents', () => {
  it('sends no hello to any of them, binds their keys, and hands none of them to sibling devices',
    { timeout: 120_000 }, async () => {
      const hellos = vi.spyOn(InternalTransport.prototype, 'sendHello');
      const agent = await createRealHouseholdAgent({ seedHousehold: false });
      const inProcess = Object.values(agent.inProcessPubKeys()).filter(Boolean);
      expect(inProcess).toHaveLength(5);

      const greeted = hellos.mock.calls.map((c) => c[0]).filter((to) => inProcess.includes(to));
      expect(greeted, 'a hello was sent to an in-process agent').toEqual([]);

      const chatSecurity = agent.sa.agent.security;
      for (const key of inProcess) expect(chatSecurity.getPeerKey(key)).toBe(key);
      const handedOn = chatSecurity.peerBindings().map((b) => b.address);
      for (const key of inProcess) expect(handedOn).not.toContain(key);

      // …and a call into them still runs: the gate and the fast path are unchanged.
      expect((await agent.callSkill('household', 'revealOwnerPhrase', {}))?.mnemonic).toBeTruthy();
    });
});
