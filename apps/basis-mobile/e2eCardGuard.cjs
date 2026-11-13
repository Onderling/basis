/**
 * The e2e maker's card (e2e/support/makerCard.fixture.json) is a fixed TEST person: an e2e build carries it as its
 * feedback contact so a walk can prove the feedback door. A build a person installs must never carry it, or their
 * feedback goes to a test identity. `app.config.js` asks this for every build: the card is refused unless the build is
 * marked e2e (`ONDERLING_E2E_BUILD=1`, which `npm run detox:build:e2e` sets).
 */
const { readFileSync } = require('node:fs');
const path = require('node:path');

/** Throws when the build's seeded card is the e2e maker's and the build is not marked e2e. */
function assertSeededCardAllowed(env = {}) {
  const card = env.EXPO_PUBLIC_SEEDED_CONTACT_CARD;
  if (!card || env.ONDERLING_E2E_BUILD === '1') return;
  const fixture = JSON.parse(readFileSync(path.join(__dirname, 'e2e', 'support', 'makerCard.fixture.json'), 'utf8'));
  if (card === fixture.uri || (fixture.webid && card.includes(fixture.webid))) {
    throw new Error('EXPO_PUBLIC_SEEDED_CONTACT_CARD is the e2e maker\'s test card: only an e2e build (ONDERLING_E2E_BUILD=1) may carry it');
  }
}

module.exports = { assertSeededCardAllowed };
