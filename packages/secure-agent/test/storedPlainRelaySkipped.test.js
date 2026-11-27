/**
 * A plain ws address to a public host that is already STORED (a device's points, a circle's recorded relay, from before
 * the wss rule) must not throw out of the agent: the relay transport refuses to be made for it, so `relays.add` answers
 * that refusal with its reason, for the default identity and for a persona alike, and the other relays still connect.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { AgentIdentity } from '@onderling/core';
import { startRelay } from '@onderling/relay';
import { createSecureAgent } from '../src/createSecureAgent.js';

const STORED_PLAIN_PUBLIC = 'ws://relay.test:8787';

describe('a stored plain public relay address is skipped with its reason', () => {
  it('relays.add answers a refusal instead of throwing; a good relay beside it still connects', async () => {
    const R = await startRelay({ port: 0, log: false });
    const good = `ws://127.0.0.1:${R.port}`;
    const anna = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, relayReadyTimeoutMs: 3000 });
    const persona = await AgentIdentity.generate(new VaultMemory());
    try {
      const own = await anna.relays.add(STORED_PLAIN_PUBLIC, { awaitReady: true });
      expect(own.ok).toBe(false);
      expect(own.reason).toBe('plain-ws-public');
      expect(own.connected).toBe(false);
      expect(anna.relays.has(STORED_PLAIN_PUBLIC)).toBe(false);

      const asPersona = await anna.relays.add(STORED_PLAIN_PUBLIC, { identity: persona, awaitReady: true });
      expect(asPersona.ok).toBe(false);
      expect(asPersona.reason).toBe('plain-ws-public');

      const opened = await anna.relays.add(good, { awaitReady: true });
      expect(opened.connected).toBe(true);
    } finally {
      try { await anna.close?.(); } catch { /* */ }
      await R.close?.();
    }
  });

  it('the primary relay setting with such an address reports, it does not throw', async () => {
    const anna = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, relayReadyTimeoutMs: 1000 });
    try {
      const r = await anna.relay.connect({ relayUrl: STORED_PLAIN_PUBLIC });
      expect(r.status).not.toBe('connected');
    } finally {
      try { await anna.close?.(); } catch { /* */ }
    }
  });
});
