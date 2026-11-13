/**
 * The e2e maker (e2e/support/makerCard.fixture.json) is a fixed TEST person: an e2e build carries its card as the
 * feedback contact so a walk can prove the feedback door. A build a person installs must never carry it, or their
 * feedback goes to a test identity. `app.config.js` asks this for every build: a card naming that person is refused
 * unless the build is marked e2e (`ONDERLING_E2E_BUILD=1`, which `npm run detox:build:e2e` sets).
 *
 * Matched by IDENTITY, not by the whole uri: the card is made at build time with this host's relay address, so its
 * text differs per machine; the person in it does not. A card holds its webid as raw bytes, so the check decodes the
 * body and looks for the maker's 32 key bytes.
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');

const PREFIX = 'onderling-contact://';

/** True when the card (a uri or a bare body) names the given webid. */
function cardNamesWebid(card, webid) {
  if (typeof card !== 'string' || typeof webid !== 'string' || !webid) return false;
  if (card.includes(webid)) return true;
  const body = card.startsWith(PREFIX) ? card.slice(PREFIX.length) : card;
  const key = Buffer.from(webid, 'base64url');
  return key.length >= 16 && Buffer.from(body, 'base64url').includes(key);
}

/** Throws when the build's seeded card names the e2e maker and the build is not marked e2e. */
function assertSeededCardAllowed(env = {}) {
  const card = env.EXPO_PUBLIC_SEEDED_CONTACT_CARD;
  if (!card || env.ONDERLING_E2E_BUILD === '1') return;
  const fixture = JSON.parse(readFileSync(path.join(__dirname, 'e2e', 'support', 'makerCard.fixture.json'), 'utf8'));
  if (cardNamesWebid(card, fixture.webid)) {
    throw new Error('EXPO_PUBLIC_SEEDED_CONTACT_CARD names the e2e maker (a test person): only an e2e build (ONDERLING_E2E_BUILD=1) may carry it');
  }
}

module.exports = { assertSeededCardAllowed, cardNamesWebid };
