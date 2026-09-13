/**
 * A hold taken while the relay socket is still opening says OFFLINE, not "no route this circle may use".
 *
 * Under a pinned transport mode the unscoped route names the relay whether or not its socket is open,
 * so the "is the peer reachable in general?" test behind the `no-eligible-route` label answered yes for
 * a socket that had not opened yet — and a send in the first second after boot was labelled as scoped
 * out. That label reaches the person as an offer to accept the address fallback, which cannot help
 * anyone who is merely early. Found 2026-09-13 by the alpha feedback walk.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { createSecureAgent } from '../src/createSecureAgent.js';

describe('the reason a hold gives while the relay socket is still opening', () => {
  it('is "unreachable" — the socket is not open — even when the send is scoped to that relay', async () => {
    const a = await createSecureAgent({ vault: new VaultMemory(), warnOnInsecure: false, relayReadyTimeoutMs: 200 });
    try {
      // A relay nobody answers on: the transport exists, its socket never opens. Not awaited, exactly as boot.
      await a.relay.connect({ relayUrl: 'ws://127.0.0.1:1' }).catch(() => { /* boot ignores this too */ });
      a.setTransportMode('relay');
      const r = await a.peer.sendTo('some-peer-key', { text: 'hoi' }, { hold: true, scope: { points: ['ws://127.0.0.1:1'] } });
      expect(r.held).toBe(true);
      expect(r.reason, 'a socket still opening is offline, not a route the circle may not use').toBe('unreachable');
    } finally {
      await a.shutdown();
    }
  });
});
