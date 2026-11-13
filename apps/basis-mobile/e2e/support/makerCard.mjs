#!/usr/bin/env node
/**
 * THE E2E MAKER: the feedback contact an e2e build carries, as a fixed test person.
 *
 * The feedback door writes to the card the BUILD carries (`EXPO_PUBLIC_SEEDED_CONTACT_CARD`), so a walk that proves the
 * door needs a build whose card is a person the walk can run: this one. A fixed root seed makes the agent the same
 * person on every boot, and its card is the one its own op prints (`getContactShareQr`), never written by hand.
 * `relayPeer.mjs --maker` boots it; `npm run detox:build:e2e` builds the APK with its card; `app.config.js` refuses
 * that card in any build not marked e2e (`ONDERLING_E2E_BUILD=1`), so the test identity cannot ship.
 *
 *   node e2e/support/makerCard.mjs        # rewrite makerCard.fixture.json from the agent's own card
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { RootKeyStoreMemory } from '@onderling/vault';

export const MAKER_HANDLE = 'onderling-test';
// WHERE the maker can be found, on its card as a real maker's card names the relay its device is on: a fixed port on
// this host, as the emulator sees the host (10.0.2.2). relayPeer --maker runs its relay on this port. Without a relay
// on the card the phone has no route but NKN, and the note waits at "Sending…" (the first walk, 2026-11-13).
export const MAKER_RELAY_PORT = 48777;
export const MAKER_CARD_RELAY = `ws://10.0.2.2:${MAKER_RELAY_PORT}`;
const MAKER_SEED = new Uint8Array(32).map((_, i) => (i * 11 + 5) & 0xff);   // fixed: the same person every run

/** A root key store holding the maker's fixed seed (what `createRealHouseholdAgent` takes as `rootKeyStore`). */
export async function makerRootKeyStore() {
  const store = new RootKeyStoreMemory();
  await store.setSeed(MAKER_SEED);
  return store;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { bootRealAgentNode, teardown } = await import('../../../basis/test/support/pairRealAgents.js');
  const node = await bootRealAgentNode('maker', { agentOpts: { rootKeyStore: await makerRootKeyStore() } });
  try {
    await node.agent.callSkill('agents', 'setProfileProperty', { id: 'default', key: 'handle', value: MAKER_HANDLE });
    const own = (await node.agent.callSkill('pinboard', 'getContactShareQr', {}))?.payload;
    if (typeof own !== 'string' || !own.startsWith('onderling-contact://')) throw new Error(`no card: ${JSON.stringify(own)}`);
    // the agent's own card, with the relay it will be on during a walk (this generator is on none): through the app's
    // own codec, both ways
    const { decodeContactCard, encodeContactCard } = await import('../../../pinboard/src/lib/contactCard.js');
    const card = decodeContactCard(own.slice('onderling-contact://'.length));
    const uri = `onderling-contact://${encodeContactCard({ ...card, relays: [MAKER_CARD_RELAY] })}`;
    const out = fileURLToPath(new URL('./makerCard.fixture.json', import.meta.url));
    writeFileSync(out, `${JSON.stringify({ handle: MAKER_HANDLE, webid: node.pubKey, relay: MAKER_CARD_RELAY, uri }, null, 2)}\n`);
    console.log(`wrote ${out}`);
  } finally { await teardown(node).catch(() => {}); }
  process.exit(0);
}
