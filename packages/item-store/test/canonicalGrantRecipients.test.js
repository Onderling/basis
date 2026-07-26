/**
 * makeCanonicalShareHook — the GRANT-side audience base (`grantRecipients`), grants-over-Peer step 2.
 *
 * `grantMember` REPLACES the recipient set with `[...currentRecipients, newRecipient]`. Passing only the
 * origin roster therefore DROPPED every previously-granted out-of-circle recipient on the next grant. The
 * hook now takes a separate, optionally WIDER grant-side base so prior key-holders survive — while REVOKE
 * deliberately keeps the conservative roster-only default (a revokee is named by WebID, not by sealing key,
 * so a widened base there would rotate the key back to the very recipient being revoked).
 */
import { describe, it, expect, vi } from 'vitest';
import { makeCanonicalShareHook } from '../src/sharedRefPolicy.js';

const ROSTER = ['k-controller', 'k-member'];
const ref = { type: 'shared-ref', sourceCircle: 'c1', sourceId: 'i1' };

/** A canonicalShare double that records the recipient set each grant/revoke was given. */
function spyShare() {
  const shares = [];
  const revokes = [];
  return {
    shares,
    revokes,
    share: vi.fn(async (p) => { shares.push(p); }),
    revoke: vi.fn(async (p) => { revokes.push(p); }),
  };
}

describe('canonical grant — the grant-side base keeps earlier out-of-circle grantees', () => {
  it('WITHOUT grantRecipients (roster only): a later grant omits the earlier grantee — the drop', async () => {
    const canonicalShare = spyShare();
    const hook = makeCanonicalShareHook({ canonicalShare, currentRecipients: () => [...ROSTER] });

    await hook.onShare({ ref, recipients: ['outA'], recipientKeys: ['k-outA'] });
    await hook.onShare({ ref, recipients: ['outB'], recipientKeys: ['k-outB'] });

    // The second grant re-wraps to roster + outB only — outA's key is NOT carried, so outA is dropped.
    expect(canonicalShare.shares[1].currentRecipients).toEqual(ROSTER);
    expect(canonicalShare.shares[1].currentRecipients).not.toContain('k-outA');
  });

  it('WITH grantRecipients (roster ∪ current key-holders): the earlier grantee is carried forward', async () => {
    const canonicalShare = spyShare();
    // Model the live wiring: the key resource's recipients grow as grants land.
    const resourceRecipients = [...ROSTER];
    canonicalShare.share = vi.fn(async (p) => {
      canonicalShare.shares.push(p);
      resourceRecipients.push(p.recipientKey);          // grantMember writes [...currentRecipients, new]
    });
    const hook = makeCanonicalShareHook({
      canonicalShare,
      currentRecipients: () => [...ROSTER],
      grantRecipients: async () => [...new Set([...ROSTER, ...resourceRecipients])],
    });

    await hook.onShare({ ref, recipients: ['outA'], recipientKeys: ['k-outA'] });
    await hook.onShare({ ref, recipients: ['outB'], recipientKeys: ['k-outB'] });

    // The second grant now re-wraps to roster + outA + outB — nobody who holds the key loses it.
    expect(canonicalShare.shares[1].currentRecipients).toContain('k-outA');
    expect(canonicalShare.shares[1].currentRecipients).toEqual(expect.arrayContaining(ROSTER));
  });

  it('a multi-recipient share still accumulates within the one call (unchanged)', async () => {
    const canonicalShare = spyShare();
    const hook = makeCanonicalShareHook({ canonicalShare, currentRecipients: () => [...ROSTER] });
    await hook.onShare({ ref, recipients: ['a', 'b'], recipientKeys: ['k-a', 'k-b'] });
    expect(canonicalShare.shares[0].currentRecipients).toEqual(ROSTER);          // first: roster
    expect(canonicalShare.shares[1].currentRecipients).toContain('k-a');         // second: + the first grantee
  });
});

describe('canonical revoke — stays roster-only (a widened base must never reach it)', () => {
  it('the revoke default uses currentRecipients, NOT grantRecipients', async () => {
    const canonicalShare = spyShare();
    const hook = makeCanonicalShareHook({
      canonicalShare,
      currentRecipients: () => [...ROSTER],
      // If revoke ever read this, the revokee's key would be rotated back in — the silent-revocation hole.
      grantRecipients: () => [...ROSTER, 'k-outA'],
    });

    await hook.revoke({ ref, recipients: ['outA'] });
    expect(canonicalShare.revokes[0].remainingRecipients).toEqual(ROSTER);
    expect(canonicalShare.revokes[0].remainingRecipients).not.toContain('k-outA');
  });

  it('an explicit remainingRecipients still wins on revoke', async () => {
    const canonicalShare = spyShare();
    const hook = makeCanonicalShareHook({
      canonicalShare, currentRecipients: () => [...ROSTER], grantRecipients: () => [...ROSTER, 'k-outA'],
    });
    await hook.revoke({ ref, recipients: ['outA'], remainingRecipients: ['k-controller'] });
    expect(canonicalShare.revokes[0].remainingRecipients).toEqual(['k-controller']);
  });
});
