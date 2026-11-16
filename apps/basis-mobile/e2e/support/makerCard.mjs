#!/usr/bin/env node
/**
 * THE E2E MAKER: the feedback contact an e2e build carries, as a fixed test person.
 *
 * The feedback door writes to the card the BUILD carries (`EXPO_PUBLIC_SEEDED_CONTACT_CARD`), so a walk that proves the
 * door needs a build whose card is a person the walk can run: this one. A fixed root seed makes the agent the same
 * person on every boot, and its card is the one its own op prints (`getContactShareQr`), never written by hand.
 * `relayPeer.mjs --maker` boots it; `npm run detox:build:e2e` builds the APK with its card (made at build time, with
 * the relay under this host's LAN address); `app.config.js` refuses a card naming this person in any build not marked
 * e2e (`ONDERLING_E2E_BUILD=1`), so the test identity cannot ship.
 *
 *   node e2e/support/makerCard.mjs            # rewrite makerCard.fixture.json (who the maker is: webid + handle)
 *   node e2e/support/makerCard.mjs --print    # print the maker's card, relay = ws://<LAN address>:48777 (last line)
 */
import { writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { RootKeyStoreMemory } from '@onderling/vault';

export const MAKER_HANDLE = 'onderling-test';
// WHERE the maker can be found: a fixed port on this host. relayPeer --maker runs its relay there; the card names it.
export const MAKER_RELAY_PORT = 48777;
const MAKER_SEED = new Uint8Array(32).map((_, i) => (i * 11 + 5) & 0xff);   // fixed: the same person every run

/**
 * The host's LAN address, which the emulator reaches too. ONE NAME FOR THE RELAY: with the card saying 10.0.2.2 (the
 * emulator's alias for the host) and the maker on 127.0.0.1, the phone and the maker recorded one relay under two urls
 * and routing fell to NKN only (the first feedback walk, 2026-11-13; the same trap the circle walks hit 2026-11-11).
 */
export function lanAddress() {
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}

/** The relay url the card names and both sides dial. */
export function makerRelayUrl(host = lanAddress()) {
  if (!host) throw new Error('no LAN address on this host: the maker card needs one spelling of the relay both sides can dial');
  return `ws://${host}:${MAKER_RELAY_PORT}`;
}

/** A root key store holding the maker's fixed seed (what `createRealHouseholdAgent` takes as `rootKeyStore`). */
export async function makerRootKeyStore() {
  const store = new RootKeyStoreMemory();
  await store.setSeed(MAKER_SEED);
  return store;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const print = process.argv.includes('--print');
  const { bootRealAgentNode, teardown } = await import('../../../basis/test/support/pairRealAgents.js');
  const node = await bootRealAgentNode('maker', { agentOpts: { rootKeyStore: await makerRootKeyStore() } });
  try {
    await node.agent.callSkill('agents', 'setProfileProperty', { id: 'default', key: 'handle', value: MAKER_HANDLE });
    const own = (await node.agent.callSkill('pinboard', 'getContactShareQr', {}))?.payload;
    if (typeof own !== 'string' || !own.startsWith('onderling-contact://')) throw new Error(`no card: ${JSON.stringify(own)}`);
    if (print) {
      // the agent's own card, with the relay it will be on during a walk (this generator is on none): through the
      // app's own codec, both ways
      const { decodeContactCard, encodeContactCard } = await import('../../../pinboard/src/lib/contactCard.js');
      const card = decodeContactCard(own.slice('onderling-contact://'.length));
      process.stdout.write(`\nonderling-contact://${encodeContactCard({ ...card, relays: [makerRelayUrl()] })}\n`);
    } else {
      const out = fileURLToPath(new URL('./makerCard.fixture.json', import.meta.url));
      writeFileSync(out, `${JSON.stringify({ handle: MAKER_HANDLE, webid: node.pubKey }, null, 2)}\n`);
      console.log(`wrote ${out}`);
    }
  } finally { await teardown(node).catch(() => {}); }
  process.exit(0);
}
