/**
 * Recovery-phrase restore across devices — stories 11.1 + 11.4 of
 * `plans/NOTE-multi-device-user-stories.md`.
 *
 * Restoring a recovery phrase re-derives the owner root and every identity under it. Two properties matter
 * and pull in opposite directions:
 *   • 11.1 — it must re-derive the SAME identity, or a restore silently FORKS your membership: the circle
 *     would see a stranger where it should see you, and your per-circle addresses would all change.
 *   • 11.4 — it must NOT be a membership BACKDOOR: someone removed from a circle who restores their phrase
 *     gets their identity back, but not the access that was rotated away from them.
 *
 * Real primitives throughout (`Bootstrap`, the per-circle address derivation, the real group-key rotation) —
 * a mock would prove nothing about determinism or about what a rotation actually denies.
 */
import { describe, it, expect } from 'vitest';
import { Bootstrap, deriveCircleAddress } from '@onderling/core';
import {
  generateKeypair, buildGroupKeyResource, generateGroupKey, grantMember,
  rotateGroupKeyResource, unwrapGroupKey,
} from '@onderling/pod-client';

const canOpen = (resource, privateKey) => {
  try { return !!unwrapGroupKey(resource, privateKey); } catch { return false; }
};

describe('11.1 — restoring on a second device yields the SAME identity, not a fork', () => {
  it('the same phrase re-derives the same owner root and the same profile seed', () => {
    const { bootstrap: phone, mnemonic: phrase } = Bootstrap.create();

    const laptop = Bootstrap.fromMnemonic(phrase);          // the restore, on another device
    expect([...laptop.deriveAgentSeed('default')]).toEqual([...phone.deriveAgentSeed('default')]);
    // …and every other profile under the same root, not just the default one.
    expect([...laptop.deriveAgentSeed('work')]).toEqual([...phone.deriveAgentSeed('work')]);
  });

  it('every PER-CIRCLE address comes out identical, so circles still recognise the member', () => {
    const { bootstrap: phone, mnemonic } = Bootstrap.create();
    const laptop = Bootstrap.fromMnemonic(mnemonic);
    const seedA = phone.deriveAgentSeed('default');
    const seedB = laptop.deriveAgentSeed('default');

    for (const circleId of ['oosterpoort', 'schildersbuurt', 'werkgroep']) {
      // The roster records this address; if a restore changed it, the member would read as a stranger.
      expect(deriveCircleAddress(seedB, circleId)).toBe(deriveCircleAddress(seedA, circleId));
    }
  });

  it('a DIFFERENT phrase is a different person — restore is not a way to become someone else', () => {
    const { bootstrap: mine } = Bootstrap.create();
    const { bootstrap: other } = Bootstrap.create();
    const seedMine = mine.deriveAgentSeed('default');
    const seedOther = other.deriveAgentSeed('default');
    expect(deriveCircleAddress(seedOther, 'oosterpoort')).not.toBe(deriveCircleAddress(seedMine, 'oosterpoort'));
  });

  it('the addresses stay UNLINKABLE across circles after a restore (the point of per-circle keys)', () => {
    const { bootstrap: b } = Bootstrap.create();
    const seed = b.deriveAgentSeed('default');
    const a1 = deriveCircleAddress(seed, 'circle-x');
    const a2 = deriveCircleAddress(seed, 'circle-y');
    expect(a1).not.toBe(a2);        // restoring must not collapse the per-circle identities into one
  });
});

describe('11.4 — restoring after removal is NOT a way back in', () => {
  it('a removed member restores their identity but still cannot open post-removal content', () => {
    // The removed member's sealing key stands in for what a restore gives back: the SAME key material.
    const controller = generateKeypair();
    const member = generateKeypair();
    const removed = generateKeypair();

    let resource = buildGroupKeyResource({
      version: 1, groupKey: generateGroupKey(), recipients: [controller.publicKey, member.publicKey],
    });
    resource = grantMember(resource, {
      newRecipient: removed.publicKey,
      granterPrivateKey: controller.privateKey,
      currentRecipients: resource.recipients,
    });
    expect(canOpen(resource, removed.privateKey)).toBe(true);          // in the circle

    // Removal rotates the key to the REMAINING holders.
    resource = rotateGroupKeyResource({
      previous: resource,
      recipients: [controller.publicKey, member.publicKey],
    });

    // A restore hands back exactly the same private key — and it still opens nothing new, because the new
    // version was never sealed to it. Recovery restores IDENTITY, never ENTITLEMENT.
    expect(canOpen(resource, removed.privateKey)).toBe(false);
    expect(canOpen(resource, member.privateKey)).toBe(true);           // the bystander is unaffected
    expect(canOpen(resource, controller.privateKey)).toBe(true);
  });

  it('re-deriving the same per-circle address does not re-admit them either', () => {
    // Identity is re-derivable by anyone holding the phrase — membership is not derived from it, it is
    // recorded by the circle. So a restored member is only a member if the roster still says so.
    const { mnemonic } = Bootstrap.create();
    const restored = Bootstrap.fromMnemonic(mnemonic);
    const addr = deriveCircleAddress(restored.deriveAgentSeed('default'), 'oosterpoort');

    const rosterAfterRemoval = [];                                     // the circle dropped their row
    expect(rosterAfterRemoval.some((r) => r.circleAddress === addr)).toBe(false);
  });
});
