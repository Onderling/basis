/**
 * FITNESS — both shells remove and leave through the SHARED operation, and the invite ceiling
 * reaches both create wizards (B4 · B5, invariants 1 + 2).
 *
 * The failure this guards against already happened here, in this exact pair of screens: web's admin
 * panel unbound the departing member's per-circle address after a removal and mobile's did not, and
 * NEITHER re-recorded the boundary-authentication snapshot, which is the step that decides whether a
 * removed member can still speak. Web de-registered a left circle's address on the transport (J-R4)
 * and mobile did not. Four small omissions, none of which produced an error message anywhere.
 *
 * Source-text guards, deliberately, for the same reason as `shellsWireCircleAddressAnnounce`: the
 * BEHAVIOUR is proven on the node harness over a real relay
 * (`test/v2/circleMembershipHygiene.relay.test.js`), and what a harness can never prove is whether a
 * SHELL bothered to call it. `src/screens/**` has no test coverage at all, so for mobile this file is
 * the only thing between a deleted line and a silent regression.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = (p) => fileURLToPath(new URL(p, import.meta.url));
const read = (p) => readFileSync(dir(p), 'utf8');

const WEB_CIRCLE_APP   = read('../../web/v2/circleApp.js');
const RN_ADMIN_PANEL   = read('../../../basis-mobile/src/screens/v2/CircleAdminPanelScreen.js');
const RN_LAUNCHER      = read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js');

describe('FITNESS — removal goes through the shared per-circle operation on both shells', () => {
  const REMOVERS = [
    ['web (circleApp.js)', WEB_CIRCLE_APP],
    ['mobile (CircleAdminPanelScreen.js)', RN_ADMIN_PANEL],
  ];

  for (const [name, source] of REMOVERS) {
    it(`${name} calls \`removeCircleMember\``, () => {
      expect(source.includes('removeCircleMember'),
        `${name} does not use the shared removal — the per-circle exit, the address unbind and the `
        + 'authorize-snapshot re-record all live in it, and a shell that skips it has changed a list').toBe(true);
    });

    it(`${name} does NOT call the raw \`removeMember\` skill directly`, () => {
      // The raw skill records the exit and rotates the key. It does not, and cannot, re-record this
      // device's authorize snapshot — that is application state above the substrate. A shell reaching
      // past the shared operation is exactly how a removal becomes a UI change again.
      expect(/callSkill\(\s*'stoop'\s*,\s*'removeMember'/.test(source),
        `${name} calls stoop.removeMember directly instead of removeCircleMember`).toBe(false);
    });
  }
});

describe('FITNESS — leaving prunes the circle locally on both shells', () => {
  const LEAVERS = [
    ['web (circleApp.js)', WEB_CIRCLE_APP],
    ['mobile (CircleLauncherScreen.js)', RN_LAUNCHER],
  ];

  for (const [name, source] of LEAVERS) {
    it(`${name} calls \`leaveCircleLocally\``, () => {
      expect(source.includes('leaveCircleLocally'),
        `${name} leaves without pruning — the circle's authorize snapshot and every member's `
        + 'per-circle address binding stay live on a device that is no longer in it').toBe(true);
    });

    it(`${name} does NOT call the raw \`leaveGroup\` skill directly`, () => {
      expect(/callSkill\(\s*'stoop'\s*,\s*'leaveGroup'/.test(source),
        `${name} calls stoop.leaveGroup directly instead of leaveCircleLocally`).toBe(false);
    });

    it(`${name} de-registers the left circle's address on its transport (J-R4)`, () => {
      // Mobile did not have this at all. The relay a left circle rode must stop receiving its
      // registration, or the privacy walk's claim is only true on one platform.
      expect(source.includes('unregisterCircleAddresses'), `${name} is missing the de-registration`).toBe(true);
    });
  }
});

describe('FITNESS — the invite ceiling reaches both create wizards', () => {
  const WIZARDS = [
    ['web (createGroupWizard.js)', read('../../src/web/wizards/createGroupWizard.js')],
    ['mobile (createGroupWizardModal.js)', read('../../src/rn/wizards/createGroupWizardModal.js')],
  ];

  for (const [name, source] of WIZARDS) {
    it(`${name} offers the ceiling field`, () => {
      expect(source.includes('inviteMaxRedemptions'),
        `${name} cannot set how many people one invite admits — the circle silently takes the fallback`).toBe(true);
    });

    it(`${name} labels it through t(), in both languages' shared block`, () => {
      expect(source.includes("t('circle.invite.ceiling_label')"),
        `${name} labels the field with a hardcoded string (invariant 8)`).toBe(true);
    });

    it(`${name} clamps to the SYSTEM cap the substrate enforces, not a number of its own`, () => {
      // A wizard offering 500 on a system that clamps to 100 is an interface stating a property the
      // code does not provide — the B8 mistake, in a new place.
      expect(source.includes('INVITE_REDEMPTION_SYSTEM_CAP'),
        `${name} does not use the shared cap`).toBe(true);
      expect(source.includes("@onderling-app/stoop/lib/inviteCeiling"),
        `${name} does not import the cap from the module that enforces it (invariant 3)`).toBe(true);
    });

    it(`${name} shows it on the review step`, () => {
      expect(source.includes("t('circle.invite.ceiling_review')"),
        `${name} lets someone create a circle without ever seeing the number they chose`).toBe(true);
    });
  }

  it('both invite surfaces say how much of the current invite is spent', () => {
    for (const [name, source] of [
      ['web (circleApp.js)', WEB_CIRCLE_APP],
      ['mobile (CircleLauncherScreen.js)', RN_LAUNCHER],
    ]) {
      expect(source.includes("t('circle.invite.uses_left'"),
        `${name} shows an invite QR without saying how many places are left on it — which is exactly `
        + 'how "one code, 300 members" stayed invisible').toBe(true);
    }
  });
});

describe('FITNESS — the ceiling is enforced where it binds, not in the joiner\'s UI', () => {
  it('the refusal is produced by the ADMIN-side redeem validator', () => {
    // The enforceability test, as a guard. If this check ever moves out of
    // `verifyMembershipCodeForPeer`, it has stopped being a ceiling and become a request.
    const stoop = read('../../../stoop/src/skills/index.js');
    const validator = stoop.slice(stoop.indexOf("defineSkill('verifyMembershipCodeForPeer'"));
    const body = validator.slice(0, validator.indexOf("defineSkill('recordRemoteRedemption'"));
    expect(body).toContain('inviteRedemptionVerdict');
    expect(body).toContain('INVITE_LIMIT_REACHED');
  });

  it('…and no join-side wizard pretends to enforce it', () => {
    // A joiner-side check would be a filter, not a gate, and having one invites the belief that the
    // gate is there. The join state may TRANSLATE the issuer's refusal; it may not produce one.
    const joinState = read('../../src/core/wizards/joinGroupState.js');
    expect(joinState).toContain('invite-redemption-limit-reached');    // recognised…
    expect(joinState).not.toContain('maxRedemptions');                 // …never decided here
  });
});
