#!/usr/bin/env node
/**
 * The e2e contact fixture: a SECOND person's contact card, made by the app's own encoder — never written by hand.
 *
 * A fixed test identity (a deterministic 32-byte seed, so the card is the same on every run) → its public key through
 * the same derivation the app uses (`AgentIdentity.pubKeyFromSeed`) → a card through stoop's `encodeContactCard` (the
 * codec the app writes with and the companion's card.js imports) → the `onderling-contact://` string a person would
 * scan or paste. Written to contactCard.fixture.json; `test/e2eContactCardFixture.test.js` regenerates it, checks the
 * committed file is identical, and reads it back through the app's own decoder.
 *
 *   node e2e/support/makeContactCard.mjs            # rewrite the fixture
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AgentIdentity } from '@onderling/core';
import { encodeContactCard } from '../../../stoop/src/lib/contactCard.js';

export const FIXTURE_NAME = 'Testa';
const SEED = new Uint8Array(32).map((_, i) => (i * 7 + 13) & 0xff);   // fixed: the same card every run

export function makeFixtureCard() {
  const pubKey = AgentIdentity.pubKeyFromSeed(SEED);
  const card = { webid: pubKey, pubKey, displayName: FIXTURE_NAME, handle: 'testa', peerAddr: pubKey };
  return { card, uri: `onderling-contact://${encodeContactCard(card)}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { card, uri } = makeFixtureCard();
  const out = fileURLToPath(new URL('./contactCard.fixture.json', import.meta.url));
  writeFileSync(out, JSON.stringify({ name: FIXTURE_NAME, webid: card.webid, uri }, null, 2) + '\n');
  console.log(`wrote ${out}`);
}
