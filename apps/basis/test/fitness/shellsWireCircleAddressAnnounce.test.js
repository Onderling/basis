/**
 * FITNESS — every shell wires per-circle ADDRESS announcing, both halves (B2).
 *
 * The failure this guards against is the one this repo repeats (invariant 2): a capability wired on
 * one shell only. It is especially invisible here, because the two halves fail differently and both
 * fail QUIETLY:
 *
 *   • no `circle-address-announce` handler ⇒ this device never learns where its co-members answer.
 *     With the global-address fallback on it keeps working while leaking the linkage per-circle
 *     addressing exists to remove; with the fallback off, messages to those members simply stop.
 *   • no `propagateCircleAddresses` on the redeem handler ⇒ an ADMIN running that shell admits
 *     people into a circle whose members can never address each other. The admin's own traffic is
 *     unaffected, so the shell looks fine to whoever is testing it.
 *
 * Source-text guards rather than behaviour, deliberately: the behaviour is covered by
 * `circleAddressAnnounce.relay.test.js` on the node harness, and what cannot be covered there is
 * whether a SHELL bothered to wire it. `src/screens/**` has no test coverage at all, so for mobile
 * this file is the only thing standing between a missing line and a silent regression.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));

/** Every shell that builds an inbound peer-handler table AND an admin-side redeem handler. */
const SHELLS = [
  { name: 'web (circleApp.js)',           file: dir('../../web/v2/circleApp.js') },
  { name: 'mobile (ChatScreen.js)',       file: dir('../../../basis-mobile/src/screens/ChatScreen.js') },
  // The node harness is a third shell in every sense that matters here: the seam-crossing tests
  // prove the mechanism THROUGH it, so a harness that stopped wiring this would turn those tests
  // green for the wrong reason.
  { name: 'node harness (pairRealAgents)', file: dir('../support/pairRealAgents.js') },
];

const SEAMS = [
  ["'circle-address-announce'",
    'this device never learns where its co-members answer in a circle — messages to them either leak '
    + 'onto their global key or, with the address fallback off, stop arriving'],
  ['makeCircleAddressAnnouncePeerHandler',
    'the subtype is routed to something other than the shared receive half, which is the one place '
    + 'that verifies the proof AND refreshes the authorize snapshot'],
  ['propagateCircleAddresses',
    'an admin on this shell admits members into a circle whose joiners can never address each other '
    + '— and the admin\'s own traffic keeps working, so nothing looks wrong'],
  ['propagateCircleAddressesAfterJoin',
    'the post-join propagation is reimplemented in the shell instead of calling the shared one '
    + '(invariant 1)'],
];

describe('FITNESS — per-circle address announcing is wired by every shell', () => {
  for (const { name, file } of SHELLS) {
    const source = readFileSync(file, 'utf8');
    for (const [seam, why] of SEAMS) {
      it(`${name} wires \`${seam}\``, () => {
        expect(source.includes(seam), `${name} is missing \`${seam}\` — ${why}`).toBe(true);
      });
    }
  }

  it('the wire kind is named ONCE, in the kernel, and imported by both the substrate and the app', () => {
    // A second literal is how the fan and the receiver come to disagree about a string, which is a
    // failure with no error message anywhere.
    const stoop = readFileSync(dir('../../../stoop/src/skills/index.js'), 'utf8');
    const basis = readFileSync(dir('../../src/v2/circleAddressAnnounce.js'), 'utf8');
    expect(stoop).toMatch(/CIRCLE_ADDRESS_ANNOUNCE_KIND/);
    expect(basis).toMatch(/CIRCLE_ADDRESS_ANNOUNCE_KIND/);
    // Neither may spell it out for itself.
    expect(stoop).not.toMatch(/'circle-address-announce'/);
    expect(basis).not.toMatch(/'circle-address-announce'/);
  });
});
