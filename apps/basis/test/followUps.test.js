/**
 * basis — follow-up registry tests. v0.4.
 */
import { describe, it, expect } from 'vitest';

import {
  collectFollowUps, createFollowUpResolver, DEFAULT_CROSS_APP_CHAINS,
} from '../src/followUps.js';

/** Mock catalog with a -populated followUpsFor. */
function fakeCatalog(perOpHints) {
  return {
    followUpsFor: (opId) => perOpHints[opId],
  };
}

describe('collectFollowUps — per-op Q31 hints', () => {
  it('returns same-app hints when the catalog has them', () => {
    const catalog = fakeCatalog({
      addMember: [{ opId: 'listOpen' }],
    });
    const out = collectFollowUps('addMember', 'household', { ok: true }, catalog);
    expect(out).toEqual([
      // J3: cross-app chain also fires (DEFAULT_CROSS_APP_CHAINS has
      // household.addMember → folio.shareFolder + stoop.postRequest)
      { opId: 'listOpen', appOrigin: 'household', prefilledArgs: undefined, label: undefined },
      { opId: 'shareFolder', appOrigin: 'folio',  prefilledArgs: {}, label: 'Share folio folder' },
      { opId: 'postRequest', appOrigin: 'stoop',  prefilledArgs: undefined, label: 'Post intro on circle' },
    ]);
  });

  it('appOrigin defaults to trigger appOrigin for per-op hints', () => {
    const catalog = fakeCatalog({
      listOpen: [{ opId: 'addMember' }],
    });
    // Use the empty default registry so cross-app chains don't interfere
    const resolver = createFollowUpResolver({ chains: [] });
    const out = resolver('listOpen', 'household', { ok: true }, catalog);
    expect(out).toEqual([{
      opId: 'addMember', appOrigin: 'household',
      prefilledArgs: undefined, label: undefined,
    }]);
  });
});

describe('collectFollowUps — cross-app chains', () => {
  it("fires household.addMember → folio.shareFolder", () => {
    const catalog = fakeCatalog({});
    const out = collectFollowUps('addMember', 'household', { ok: true, memberName: 'Anne' }, catalog);
    expect(out.some((e) => e.appOrigin === 'folio' && e.opId === 'shareFolder')).toBe(true);
    expect(out.some((e) => e.appOrigin === 'stoop' && e.opId === 'postRequest')).toBe(true);
  });

  it("fires stoop.postRequest → stoop.listFeed", () => {
    const catalog = fakeCatalog({});
    const out = collectFollowUps('postRequest', 'stoop', { ok: true }, catalog);
    expect(out.some((e) => e.appOrigin === 'stoop' && e.opId === 'listFeed')).toBe(true);
  });

  it("no match when neither catalog nor registry has a chain", () => {
    const catalog = fakeCatalog({});
    const out = collectFollowUps('completelyUnknown', 'household', { ok: true }, catalog);
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
    const out = resolver('x', 'a', { ok: true }, fakeCatalog({}));
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
    expect(resolver('x', 'a', { kind: 'special' }, fakeCatalog({})).length).toBe(1);
    expect(resolver('x', 'a', { kind: 'other'   }, fakeCatalog({})).length).toBe(0);
  });
});

describe('collectFollowUps — dedup', () => {
  it('dedupes by appOrigin.opId across per-op + cross-app sources', () => {
    const catalog = fakeCatalog({
      addMember: [
        // Same as the cross-app chain — should dedup
        { opId: 'shareFolder', appOrigin: 'folio' },
      ],
    });
    const out = collectFollowUps('addMember', 'household', { ok: true }, catalog);
    const folioShares = out.filter((e) => e.appOrigin === 'folio' && e.opId === 'shareFolder');
    expect(folioShares.length).toBe(1);
  });
});

describe('DEFAULT_CROSS_APP_CHAINS — sanity', () => {
  it('declares the J3 chains', () => {
    const triggers = DEFAULT_CROSS_APP_CHAINS.map((c) => `${c.trigger.appOrigin}.${c.trigger.opId}`);
    expect(triggers).toContain('household.addMember');
    expect(triggers).toContain('stoop.postRequest');
  });
});
