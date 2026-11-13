/**
 * THE E2E MAKER'S CARD NEVER SHIPS. An e2e build carries a fixed test person as its feedback contact
 * (e2e/support/makerCard.fixture.json) so a walk can prove the feedback door; a build a person installs must never
 * carry it, or their feedback would go to a test identity. The app config refuses a card naming that person unless the
 * build is marked e2e (`ONDERLING_E2E_BUILD=1`), whatever relay the card names (it is made per machine at build
 * time), and the config does ask (read from its source: it only runs under Expo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { encodeContactCard } from '../../pinboard/src/lib/contactCard.js';

const require = createRequire(import.meta.url);
const { assertSeededCardAllowed } = require('../e2eCardGuard.cjs');
const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../e2e/support/makerCard.fixture.json', import.meta.url)), 'utf8'));
const cardOf = (webid, relay) => `onderling-contact://${encodeContactCard({ webid, pubKey: webid, handle: fixture.handle, relays: [relay] })}`;
const makerCard = cardOf(fixture.webid, 'ws://192.168.1.20:48777');
const otherWebid = Buffer.alloc(32, 7).toString('base64url');

describe('the e2e maker card never ships', () => {
  it('a build carrying the maker, under any relay, and not marked e2e is refused', () => {
    expect(() => assertSeededCardAllowed({ EXPO_PUBLIC_SEEDED_CONTACT_CARD: makerCard })).toThrow(/e2e/);
    expect(() => assertSeededCardAllowed({ EXPO_PUBLIC_SEEDED_CONTACT_CARD: cardOf(fixture.webid, 'ws://10.0.0.9:48777') })).toThrow(/e2e/);
  });
  it('the e2e build may carry it', () => {
    expect(() => assertSeededCardAllowed({ EXPO_PUBLIC_SEEDED_CONTACT_CARD: makerCard, ONDERLING_E2E_BUILD: '1' })).not.toThrow();
  });
  it('another person\'s card, or none, passes', () => {
    expect(() => assertSeededCardAllowed({ EXPO_PUBLIC_SEEDED_CONTACT_CARD: cardOf(otherWebid, 'ws://192.168.1.20:48777') })).not.toThrow();
    expect(() => assertSeededCardAllowed({})).not.toThrow();
  });
  it('the app config asks, for every build', () => {
    expect(readFileSync(fileURLToPath(new URL('../app.config.js', import.meta.url)), 'utf8')).toMatch(/assertSeededCardAllowed\(process\.env\)/);
  });
});
