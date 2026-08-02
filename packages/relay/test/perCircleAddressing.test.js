/**
 * G13 step B — a client is reachable at its per-circle addresses.
 *
 * Step A made the relay accept several addresses per socket. This is the other half: the client actually
 * registering them, and staying registered across a reconnect.
 *
 * Driven against a REAL relay over a real socket with the REAL `RelayTransport`, because the interesting
 * failure is the one a unit test cannot see — the aliases surviving a dropped connection. A new socket
 * knows nothing about the last one, so without replay a device would be reachable per-circle exactly once,
 * until the first blip, and then silently only at its primary address.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startRelay } from '../src/server.js';
import { RelayTransport } from '@onderling/transports';
import { AgentIdentity, deriveCircleAddress, circleAddressSigner } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { randomBytes } from 'node:crypto';

const settle = (ms = 120) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, ms = 2_000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error(`timeout (${ms}ms)`);
    await new Promise((r) => setTimeout(r, 15));
  }
}

/**
 * Anna's profile seed and, from it, her REAL per-circle addresses. Since 2026-07-31 an alias is not a
 * label but a key the relay makes you prove (Decision 3), so an alias comes as a pair: the address
 * `deriveCircleAddress` produces, and the signer for the key behind it. `circleAddressSigner` is
 * vault-free, which is what keeps registering N circles as cheap as registering one.
 */
const ANNA_SEED = new Uint8Array(randomBytes(32));
const circleAddr = (circleId) => deriveCircleAddress(ANNA_SEED, circleId);
const circleAlias = (circleId) => [circleAddr(circleId), { sign: circleAddressSigner(ANNA_SEED, circleId) }];

describe('a device is reachable at its per-circle addresses', () => {
  let relay; let url; let anna; let bram; let annaId; let bramId;
  const inbox = [];

  beforeEach(async () => {
    relay = await startRelay({ port: 0 });
    url = `ws://127.0.0.1:${relay.port}`;
    [annaId, bramId] = await Promise.all([
      AgentIdentity.generate(new VaultMemory()),
      AgentIdentity.generate(new VaultMemory()),
    ]);
    anna = new RelayTransport({ relayUrl: url, identity: annaId });
    bram = new RelayTransport({ relayUrl: url, identity: bramId });
    inbox.length = 0;
    // The base Transport emits 'envelope' for an inbound payload when no receive handler is set.
    anna.on('envelope', (payload) => inbox.push(payload));
    await Promise.all([anna.connect(), bram.connect()]);
  });

  afterEach(async () => {
    try { await anna.disconnect(); } catch { /* */ }
    try { await bram.disconnect(); } catch { /* */ }
    await relay.stop();
  });

  it('registers an alias and receives at it', async () => {
    await anna.addAddress(...circleAlias('anna@oosterpoort'));
    await settle();

    await bram._put(circleAddr('anna@oosterpoort'), { subtype: 'kring-chat-message', text: 'hoi' });
    await waitFor(() => inbox.length >= 1);
    expect(JSON.stringify(inbox[0])).toContain('hoi');
  });

  it('the PRIMARY address keeps working — nothing breaks while senders migrate', async () => {
    // Step C has not happened yet, so most senders still address the global key. Adding an alias must not
    // take that away, or the migration would be a flag day rather than a staged one.
    await anna.addAddress(...circleAlias('anna@oosterpoort'));
    await settle();

    await bram._put(annaId.pubKey, { subtype: 'kring-chat-message', text: 'old-path' });
    await waitFor(() => inbox.length >= 1);
    expect(anna.addresses).toEqual([annaId.pubKey, circleAddr('anna@oosterpoort')]);
  });

  it('several circles, several addresses, one connection', async () => {
    for (const c of ['anna@x', 'anna@y', 'anna@z']) await anna.addAddress(...circleAlias(c));
    await settle();

    for (const c of ['anna@x', 'anna@y', 'anna@z']) {
      await bram._put(circleAddr(c), { subtype: 'kring-chat-message', to: circleAddr(c) });
    }
    await waitFor(() => inbox.length >= 3);
    expect(anna.addresses).toHaveLength(4);            // primary + three circles
  });

  it('aliases SURVIVE a reconnect — the failure a unit test cannot see', async () => {
    await anna.addAddress(...circleAlias('anna@oosterpoort'));
    await settle();

    // Drop the socket the way a flaky network would, then let it come back.
    await anna.disconnect();
    await settle();
    await anna.connect();
    await settle(250);

    await bram._put(circleAddr('anna@oosterpoort'), { subtype: 'kring-chat-message', text: 'after-reconnect' });
    await waitFor(() => inbox.length >= 1);
  });

  it('adding the same alias twice is idempotent', async () => {
    await anna.addAddress(...circleAlias('anna@x'));
    await anna.addAddress(...circleAlias('anna@x'));
    expect(anna.addresses).toEqual([annaId.pubKey, circleAddr('anna@x')]);
  });

  it('the primary is never added as an alias', async () => {
    await anna.addAddress(annaId.pubKey);
    expect(anna.addresses).toEqual([annaId.pubKey]);
  });

  it('junk is ignored rather than registered', async () => {
    for (const bad of [null, undefined, '', 42, {}]) await anna.addAddress(bad);
    expect(anna.addresses).toEqual([annaId.pubKey]);
  });

  it('removing an alias takes it out of the replay set', async () => {
    await anna.addAddress(...circleAlias('anna@stays'));
    await anna.addAddress(...circleAlias('anna@leaving'));
    anna.removeAddress(circleAddr('anna@leaving'));

    // `addresses` IS the replay set — `#aliases` is exactly what `onopen` re-registers — so this is the
    // claim, not a proxy for it.
    expect(anna.addresses).toEqual([annaId.pubKey, circleAddr('anna@stays')]);

    // NOT asserted here: that the RELAY forgets it after a reconnect. A removed alias only disappears
    // relay-side on reconnect (a socket cannot un-register one address today), and every way of observing
    // that from this harness — sending to the dead address, or watching a peer list — either hangs on a
    // held message or fights the transport's already-seen dedupe. Left to J-G13.2 on a real device rather
    // than faked here.
  });
});
