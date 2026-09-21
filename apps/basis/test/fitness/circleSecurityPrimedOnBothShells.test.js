/**
 * Both shells prime circle security through the SAME entry point, at boot.
 *
 * This is a text fitness guard, not a behaviour test, and that is deliberate: the two shell files it reads
 * have no runtime coverage at all (`apps/basis/web/v2/circleApp.js`, `apps/basis-mobile/src/core/
 * agentBundle.js`), which is exactly how they came to disagree in the first place — web primed from
 * `circlesCache` while mobile asked the substrate, and neither fed the roster that authorizes senders.
 *
 * What it enforces:
 *   1. both shells call `primeCircleSecurity`;
 *   2. neither reaches past it to `installCircleIdentities` directly — that is the half-wiring that made
 *      the two shells differ, and it would silently skip the roster half;
 *   3. the primer itself does not depend on household sync (the security snapshot was a passenger on it).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../../../..', import.meta.url).pathname;
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
/**
 * Source with comments removed.
 *
 * Needed because these files EXPLAIN what they deliberately do not do — the primer's header says why it
 * does not read `circlesCache`, and a guard that reads prose would fail on the explanation. (The ledger
 * guard hit the same thing on its own documentation the same day.)
 */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SHELLS = {
  web:    'apps/basis/web/v2/circleApp.js',
  mobile: 'apps/basis-mobile/src/core/agentBundle.js',
};

describe('web ≡ mobile, by construction', () => {
  for (const [name, path] of Object.entries(SHELLS)) {
    it(`${name} primes circle security through the shared entry point`, () => {
      const src = read(path);
      expect(src).toMatch(/primeCircleSecurity\s*\(/);
      expect(src).toMatch(/circleSecurityPriming\.js/);
    });

    it(`${name} does NOT reach past the primer to installCircleIdentities`, () => {
      // Calling it directly skips the roster half, which is the shape of the original bug: the identity
      // was installed for every circle and the roster for only the ones someone opened.
      const src = read(path);
      const direct = src.match(/installCircleIdentities\s*\?*\.?\s*\(/g) ?? [];
      expect(direct, `${path} calls installCircleIdentities directly`).toEqual([]);
    });
  }
});

describe('the primer stands on its own', () => {
  const src = read('apps/basis/src/v2/circleSecurityPriming.js');
  const bare = code('apps/basis/src/v2/circleSecurityPriming.js');

  it('asks the SUBSTRATE for the circle list, not a render cache', () => {
    expect(bare).toMatch(/listMyCircles/);
    expect(bare).not.toMatch(/circlesCache/);
  });

  it('does not route the security snapshot through household sync', () => {
    // `feedHouseholdRoster` returns early unless `addCirclePeer` exists, so the authorize snapshot
    // inside it silently did not happen for any agent without household pairing. Security state must not
    // be gated behind an unrelated capability.
    expect(bare).toMatch(/bindCircleAddressKeysFor/);
    expect(bare).not.toMatch(/feedHouseholdRoster\s*\(/);
  });

  it('unions rather than replaces, so a caller cannot lower the floor', () => {
    expect(bare).toMatch(/new Set\(\[[\s\S]{0,120}fromSubstrate/);
  });
});

/**
 * PRESENCE covers every circle the SUBSTRATE holds — the pair circles included (2026-09-21).
 *
 * Measured on Frits' phone: after a reload, its message to Wilfred over the pair route left signed as the
 * phone's canonical identity and the box refused it at the door ("a member's canonical identity … only the
 * per-circle key may speak") — three times, nothing fanned, nothing on the laptop. Web's `registerCirclePresence`
 * took its circle ids from `circlesCache`, the LAUNCHER's list, which `loadCircles` filters pair circles OUT of
 * (they are hidden tiles by design). So a pair circle's per-circle address was registered on the relay only at
 * the join, never again: the transport did not hold it after a reload, the send fell back to the primary
 * address, and every contact's door refuses that. Mobile and the box asked the substrate all along.
 */
describe('presence covers what the substrate holds, not what the launcher shows', () => {
  it('web takes the circle ids for relay registration from listMyCircles, never from the render cache alone', () => {
    const bare = code(SHELLS.web);
    const fn = bare.slice(bare.indexOf('function registerCirclePresence('), bare.indexOf('\n}', bare.indexOf('function registerCirclePresence(')));
    expect(fn, 'registerCirclePresence must read the substrate').toMatch(/listMyCircles/);
  });
  it('the launcher list is a VIEW: it hides pair circles, and that is fine — presence must not read it', () => {
    expect(code('apps/basis/src/v2/circleModel.js')).toMatch(/isPairCircleId/);
  });
});
