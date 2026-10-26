/**
 * basis — follow-up registry tests. v0.4.
 */
import { describe, it, expect } from 'vitest';

import {
  collectFollowUps, createFollowUpResolver, DEFAULT_CROSS_APP_CHAINS,
} from '../src/followUps.js';

/** Mock catalogue with a -populated followUpsFor. */
function fakeCatalogue(perOpHints) {
  return {
    followUpsFor: (opId) => perOpHints[opId],
  };
}

describe('collectFollowUps — per-op Q31 hints', () => {
  it('returns same-app hints when the catalogue has them', () => {
    const catalogue = fakeCatalogue({
      postRequest: [{ opId: 'listMyRequests' }],
    });
    const out = collectFollowUps('postRequest', 'pinboard', { ok: true }, catalogue);
    expect(out).toEqual([
      // the cross-app chain also fires (DEFAULT_CROSS_APP_CHAINS has pinboard.postRequest → pinboard.listFeed)
      { opId: 'listMyRequests', appOrigin: 'pinboard', prefilledArgs: undefined, label: undefined },
      { opId: 'listFeed', appOrigin: 'pinboard', prefilledArgs: undefined, label: 'View feed' },
    ]);
  });

  it('appOrigin defaults to trigger appOrigin for per-op hints', () => {
    const catalogue = fakeCatalogue({
      listOpen: [{ opId: 'addMember' }],
    });
    // Use the empty default registry so cross-app chains don't interfere
    const resolver = createFollowUpResolver({ chains: [] });
    const out = resolver('listOpen', 'household', { ok: true }, catalogue);
    expect(out).toEqual([{
      opId: 'addMember', appOrigin: 'household',
      prefilledArgs: undefined, label: undefined,
    }]);
  });
});

describe('collectFollowUps — cross-app chains', () => {
  it("fires pinboard.postRequest → pinboard.listFeed", () => {
    const catalogue = fakeCatalogue({});
    const out = collectFollowUps('postRequest', 'pinboard', { ok: true }, catalogue);
    expect(out.some((e) => e.appOrigin === 'pinboard' && e.opId === 'listFeed')).toBe(true);
  });

  it("no match when neither catalogue nor registry has a chain", () => {
    const catalogue = fakeCatalogue({});
    const out = collectFollowUps('completelyUnknown', 'household', { ok: true }, catalogue);
    expect(out).toEqual([]);
  });
});

describe('createFollowUpResolver — custom chains', () => {
  it("isolates from the default registry", () => {
    const resolver = createFollowUpResolver({
      chains: [{
        trigger:    { appOrigin: 'a', opId: 'x' },
        suggestion: { appOrigin: 'b', opId: 'y', label: 'Y' },
      }],
    });
    const out = resolver('x', 'a', { ok: true }, fakeCatalogue({}));
    expect(out).toEqual([
      { opId: 'y', appOrigin: 'b', prefilledArgs: undefined, label: 'Y' },
    ]);
  });

  it("'when' gate filters by reply payload", () => {
    const resolver = createFollowUpResolver({
      chains: [{
        trigger:    { appOrigin: 'a', opId: 'x' },
        suggestion: { appOrigin: 'b', opId: 'y' },
        when:       (reply) => reply.kind === 'special',
      }],
    });
    expect(resolver('x', 'a', { kind: 'special' }, fakeCatalogue({})).length).toBe(1);
    expect(resolver('x', 'a', { kind: 'other'   }, fakeCatalogue({})).length).toBe(0);
  });
});

describe('collectFollowUps — dedup', () => {
  it('dedupes by appOrigin.opId across per-op + cross-app sources', () => {
    const catalogue = fakeCatalogue({
      postRequest: [
        // Same as the cross-app chain — should dedup
        { opId: 'listFeed', appOrigin: 'pinboard' },
      ],
    });
    const out = collectFollowUps('postRequest', 'pinboard', { ok: true }, catalogue);
    const feeds = out.filter((e) => e.appOrigin === 'pinboard' && e.opId === 'listFeed');
    expect(feeds.length).toBe(1);
  });
});

describe('DEFAULT_CROSS_APP_CHAINS — sanity', () => {
  it('declares the post → feed chain, and none on the retired member-add shim', () => {
    const triggers = DEFAULT_CROSS_APP_CHAINS.map((c) => `${c.trigger.appOrigin}.${c.trigger.opId}`);
    expect(triggers).not.toContain('household.addMember');
    expect(triggers).toContain('pinboard.postRequest');
  });
});
