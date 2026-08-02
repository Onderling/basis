/**
 * FITNESS — the roster authorize is wired ONCE, in shared code, and no shell has to remember it.
 *
 * ── What this guards, and why it is shaped as an inversion of its neighbour ─────────────────────
 * `shellsInstallCircleIdentities.test.js` guards a seam each shell MUST call. This one guards the
 * opposite arrangement, deliberately chosen for Decision 1: the roster authorize is installed at
 * agent construction, in `realAgent.js`, which both shells already share. So `web ≡ mobile` holds
 * **by construction** rather than by two shells remembering the same thing — which is the stronger
 * form of invariant 2, and the form to prefer whenever the seam does not genuinely need a
 * per-platform adapter. This one does not: it needs a roster, and rosters are not platform-shaped.
 *
 * The guard therefore has two halves, and the second is the load-bearing one:
 *   1. the install and the feed exist in shared code;
 *   2. **neither shell mentions them at all** — because the day one does, the arrangement has
 *      silently become the other kind, and the other shell is one commit from being forgotten.
 *
 * ── Why this file exists rather than trusting the end-to-end test ──────────────────────────────
 * `test/v2/circleSenderAuthorization.relay.test.js` proves the whole chain works — but it boots one
 * agent through one code path. It would keep passing if someone moved the install into the web
 * shell and mobile quietly lost the check, which is exactly the failure this repo has had twice.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(dir(p), 'utf8');

const realAgent      = read('../../src/core/agent/realAgent.js');
const rosterPairing  = read('../../src/v2/householdRosterPairing.js');
const SHELLS = [
  { name: 'web (circleApp.js)',      source: read('../../web/v2/circleApp.js') },
  { name: 'mobile (agentBundle.js)', source: read('../../../basis-mobile/src/core/agentBundle.js') },
];

describe('FITNESS — Decision 1\'s roster authorize is installed in shared code', () => {
  it('the shared agent factory INSTALLS the port on the kernel', () => {
    expect(realAgent, 'realAgent builds the circle sender authorization')
      .toMatch(/createCircleSenderAuthorization\s*\(/);
    expect(realAgent, 'and hands its authorizer to the secure agent, which hands it to the kernel')
      .toMatch(/setSenderAuthorizer\s*\?\.\(\s*circleSenders\.authorizeSender\s*\)/);
  });

  it('the shared roster read FEEDS it, from the same rows that bind each member\'s address', () => {
    // Two reads of one fact is how the sealing binding and the authorize snapshot come to disagree
    // about who is in a circle — and a disagreement here is either a leak or an outage.
    expect(rosterPairing).toMatch(/recordCircleSenders\s*\?\.\(/);
    const recordAt = rosterPairing.indexOf('recordCircleSenders');
    const bindAt   = rosterPairing.indexOf('bindCircleAddressKeys({');
    expect(recordAt, 'both are fed from the same listGroupMembers result').toBeGreaterThan(-1);
    expect(bindAt).toBeGreaterThan(-1);
    const between = rosterPairing.slice(Math.min(recordAt, bindAt), Math.max(recordAt, bindAt));
    expect(between, 'with no second roster read between them').not.toMatch(/callSkill\(/);
  });

  it('NEITHER shell touches it — if one does, the other is one commit from losing the check', () => {
    for (const { name, source } of SHELLS) {
      for (const seam of ['setSenderAuthorizer', 'createCircleSenderAuthorization', 'recordCircleSenders']) {
        expect(
          source.includes(seam),
          `${name} references \`${seam}\`. The roster authorize is deliberately installed once, in `
          + 'shared code, so that no shell can forget it. Wiring it in a shell makes it a thing two '
          + 'shells must remember — put it back in `realAgent.js` / `householdRosterPairing.js`.',
        ).toBe(false);
      }
    }
  });

  it('the kernel-side port is reachable from the substrate the app actually holds', () => {
    // The chain in one assertion: SecurityLayer ← createSecureAgent ← realAgent. A missing middle
    // link is the exact shape of Decision 3's inert seam, and it fails silently — `sa.setSender…?.()`
    // is optional-called, so a substrate that dropped the method would look like it worked.
    const secureAgent = readFileSync(
      dir('../../../../packages/secure-agent/src/createSecureAgent.js'), 'utf8',
    );
    expect(secureAgent, 'the substrate passes the port through')
      .toMatch(/setSenderAuthorizer\s*\(\s*authorizer\s*\)\s*\{/);
    expect(secureAgent).toMatch(/agent\.security\.setSenderAuthorizer\(authorizer\)/);
  });
});
