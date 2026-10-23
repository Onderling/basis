/**
 * The Transport port's SENDER-BINDING case over the relay. The binding here is the SERVER's, not the client's:
 * `register` needs a proof of the address's key (challenge → `register-proof`), and a `send` whose `envelope._from`
 * is not one of the socket's registered addresses is refused (`WsServerTransport`, `SENDER_NOT_REGISTERED`, through
 * the kernel's `senderVerdict`). So the client `RelayTransport` carries no `createSenderBinding` of its own — this
 * run is what proves the relay binds, over a real server and two real client sockets.
 */
import { describe, it } from 'vitest';
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { assertSenderBindingConformance } from '@onderling/core/conformance';
import { RelayTransport } from '@onderling/transports';
import { startRelay } from '../src/server.js';

describe('Transport port — sender binding over the relay', () => {
  it('a client frame claiming an address its socket did not prove is refused by the relay', async () => {
    const relay = await startRelay({ port: 0, log: false });
    try {
      await assertSenderBindingConformance(async () => {
        const relayUrl = `ws://127.0.0.1:${relay.port}`;
        const [ia, ib, other] = await Promise.all([1, 2, 3].map(() => AgentIdentity.generate(new VaultMemory())));
        const a = new RelayTransport({ relayUrl, identity: ia });
        const b = new RelayTransport({ relayUrl, identity: ib });
        await a.connect(); await b.connect();
        return { a, b, addrA: a.address, addrB: b.address, forgedAddr: other.pubKey,
          async teardown() { await a.disconnect().catch(() => {}); await b.disconnect().catch(() => {}); } };
      }, { label: 'RelayTransport (server-side binding)' });
    } finally { await relay.stop(); }
  });
});
