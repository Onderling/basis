/**
 * THE E2E MAKER'S CARD NEVER SHIPS. An e2e build carries a fixed test person as its feedback contact
 * (e2e/support/makerCard.fixture.json) so a walk can prove the feedback door; a build a person installs must never
 * carry it, or their feedback would go to a test identity. The app config refuses that card unless the build is marked
 * e2e (`ONDERLING_E2E_BUILD=1`), and the config does ask (read from its source: it only runs under Expo).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { assertSeededCardAllowed } = require('../e2eCardGuard.cjs');
const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('../e2e/support/makerCard.fixture.json', import.meta.url)), 'utf8'));

describe('the e2e maker card never ships', () => {
  it('a build carrying the e2e card and not marked e2e is refused', () => {
    expect(() => assertSeededCardAllowed({ EXPO_PUBLIC_SEEDED_CONTACT_CARD: fixture.uri })).toThrow(/e2e/);
  });
  it('the e2e build may carry it', () => {
    expect(() => assertSeededCardAllowed({ EXPO_PUBLIC_SEEDED_CONTACT_CARD: fixture.uri, ONDERLING_E2E_BUILD: '1' })).not.toThrow();
  });
  it('another card, or none, passes', () => {
    expect(() => assertSeededCardAllowed({ EXPO_PUBLIC_SEEDED_CONTACT_CARD: 'onderling-contact://AAAA' })).not.toThrow();
    expect(() => assertSeededCardAllowed({})).not.toThrow();
  });
  it('the app config asks, for every build', () => {
    expect(readFileSync(fileURLToPath(new URL('../app.config.js', import.meta.url)), 'utf8')).toMatch(/assertSeededCardAllowed\(process\.env\)/);
  });
});
