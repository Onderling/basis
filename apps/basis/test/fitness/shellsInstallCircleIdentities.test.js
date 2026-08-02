/**
 * FITNESS — both shells install this device's per-circle SIGNING identities (Decision 4).
 *
 * The identity has to be installed for every circle this device is in, on both shells, or the shell
 * that forgot cannot open anything sent to its own per-circle address and signs that circle as the
 * person. Neither failure raises anything: the box simply does not open.
 *
 * This is the defect this repo repeats — a capability wired on one shell only (invariant 2). It has
 * already happened once inside this very seam: the proof-of-possession signer for a per-circle
 * address (`circleAddressSignerFor`, Decision 3) was passed by `basis-mobile` and NOT by the web
 * shell, so every per-circle alias was refused on web alone. So this guard covers both calls that
 * make per-circle addressing work, at every place either shell registers a circle's presence.
 *
 * A third shell is fine; a third shell that forgets is not.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));

/** Where each shell registers this device's per-circle presence. */
const SHELL_SITES = [
  { name: 'web (circleApp.js)',        file: dir('../../web/v2/circleApp.js') },
  { name: 'mobile (agentBundle.js)',   file: dir('../../../basis-mobile/src/core/agentBundle.js') },
];

/** The two seams, and what breaks when one is missing. */
const SEAMS = [
  // 2026-08-02: the shells no longer call `installCircleIdentities` themselves — they call
  // `primeCircleSecurity`, which installs identities AND records the roster snapshot that authorizes
  // senders, for every circle the SUBSTRATE knows rather than for the ones a screen happened to load.
  // The property this guard protects is unchanged (every shell installs identities for every circle);
  // only the route is. Reaching past the primer is now itself a defect, and
  // `circleSecurityPrimedOnBothShells.test.js` fails on it.
  ['primeCircleSecurity',
    'this device signs its circles as its global identity, cannot open what is sealed to its '
    + 'per-circle address, and records no roster — so it accepts that circle\'s traffic unchecked '
    + '(Decisions 4 + 1)'],
  ['circleAddressSignerFor',
    'the relay refuses every per-circle alias, because an address is a key and registering one means '
    + 'proving it (Decision 3)'],
];

describe('FITNESS — per-circle identity is installed by every shell', () => {
  for (const { name, file } of SHELL_SITES) {
    const source = readFileSync(file, 'utf8');

    it(`${name} registers circle presence at all`, () => {
      expect(source).toMatch(/registerCircleAddresses\s*\(/);
    });

    for (const [seam, why] of SEAMS) {
      it(`${name} passes \`${seam}\``, () => {
        expect(source.includes(seam), `${name} does not pass \`${seam}\` — ${why}`).toBe(true);
      });
    }
  }

  it('the installer itself lives in shared code, not in a shell', () => {
    // Invariant 1: the shells inject seams; the logic is one source both call.
    const shared = readFileSync(dir('../../src/v2/circleSigningIdentity.js'), 'utf8');
    expect(shared).toMatch(/export async function installCircleSigningIdentities/);
    for (const { file } of SHELL_SITES) {
      const source = readFileSync(file, 'utf8');
      expect(source, 'a shell derived a per-circle identity itself instead of calling the agent seam')
        .not.toMatch(/circleIdentity\s*\(\s*[\w.]*profileSeed/);
    }
  });
});
