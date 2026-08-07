/**
 * circleShareScreen — the portable interaction model behind the RN cross-circle SHARE screen
 * (objective L · invariant #2 web≡mobile). Vitest can't render RN components (see vitest.config.js), so
 * this exercises `src/core/circleShareScreen.js` with the composition-root wrappers FAKED — proving the
 * screen is a thin adapter that:
 *   • enumerates the circle's own items to share out (drops `shared-ref` pointers),
 *   • the Share action calls `shareItemIntoCircle` with the right args,
 *   • the shared-list renders rows from `listSharedItems` with canonical gating,
 *   • the "Stop sharing" action calls `unshareItemFromCircle` for a CANONICAL row only, and a copy row
 *     surfaces `not_revocable` WITHOUT touching the revoke wrapper.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  loadShareableItems, loadSharedRows, shareRowFrom, shareOut, stopSharing, pickableCircles,
  outOfCircleLinkWarning, pickableRecipients, shareToRecipient,
} from '../src/core/circleShareScreen.js';

// A fake lists service exposing only the store surface loadShareableItems reads.
function fakeListsService(itemsByCircle) {
  return { stores: { getStore: (id) => ({ list: async () => itemsByCircle[id] ?? [] }) } };
}

describe('circle share screen model (objective L)', () => {
  it('loadShareableItems lists the circle\'s own items and drops shared-ref pointers', async () => {
    const deps = {
      getCircleLists: vi.fn(async () => fakeListsService({
        A: [
          { id: 'i1', type: 'list', text: 'Groceries' },
          { id: 'i2', type: 'list-item', text: 'Milk' },
          { id: 'r1', type: 'shared-ref', sourceCircle: 'B', sourceId: 'x' },   // dropped
        ],
      })),
    };
    const items = await loadShareableItems({ circleId: 'A', policy: { sharePosture: 'canonical' }, deps });
    expect(deps.getCircleLists).toHaveBeenCalledWith('A', { sharePosture: 'canonical' });
    expect(items).toEqual([
      { id: 'i1', text: 'Groceries', type: 'list' },
      { id: 'i2', text: 'Milk', type: 'list-item' },
    ]);
  });

  it('pickableCircles offers the OTHER circles as targets and EXCLUDES the source circle', () => {
    const circles = [
      { id: 'A', name: 'Household' },   // source — excluded
      { id: 'B', name: 'Street' },
      { id: 'C', name: 'Book club' },
      { id: '', name: 'no-id' },        // no id — dropped
    ];
    const targets = pickableCircles({ circles, sourceCircleId: 'A' });
    expect(targets).toEqual([
      { id: 'B', name: 'Street' },
      { id: 'C', name: 'Book club' },
    ]);
    // A picked target id feeds straight into shareOut → shareItemIntoCircle({ toCircleId }).
    expect(targets.map((c) => c.id)).not.toContain('A');
  });

  it('pickableCircles falls back to the id as label when a circle has no name, and is empty when only the source exists', () => {
    expect(pickableCircles({ circles: [{ id: 'A', name: 'Only me' }], sourceCircleId: 'A' })).toEqual([]);
    expect(pickableCircles({ circles: [{ id: 'B' }], sourceCircleId: 'A' })).toEqual([{ id: 'B', name: 'B' }]);
    expect(pickableCircles({ circles: undefined, sourceCircleId: 'A' })).toEqual([]);
  });

  it('picking a circle then confirming shares that circle\'s id as toCircleId (picker → shareItemIntoCircle)', async () => {
    const shareItemIntoCircle = vi.fn(async () => ({ ok: true, ref: {} }));
    const circles = [{ id: 'A', name: 'Household' }, { id: 'B', name: 'Street' }];
    const targets = pickableCircles({ circles, sourceCircleId: 'A' });
    const picked = targets[0];   // user selects "Street"
    const s = await shareOut({
      itemId: 'i1', fromCircleId: 'A', toCircleId: picked.id, by: 'did:alice', recipient: 'did:bob',
      policyOf: async () => ({}), deps: { shareItemIntoCircle },
    });
    expect(shareItemIntoCircle).toHaveBeenCalledWith(expect.objectContaining({ toCircleId: 'B', itemId: 'i1', fromCircleId: 'A' }));
    expect(s.ok).toBe(true);
  });

  it('shareOut calls shareItemIntoCircle with the right args and returns a done status', async () => {
    const shareItemIntoCircle = vi.fn(async () => ({ ok: true, ref: {} }));
    const policyOf = async () => ({ sharePosture: 'canonical' });
    const s = await shareOut({
      itemId: 'i1', fromCircleId: 'A', toCircleId: '  B  ', by: 'did:alice', recipient: 'did:bob',
      policyOf, deps: { shareItemIntoCircle },
    });
    expect(shareItemIntoCircle).toHaveBeenCalledWith({
      itemId: 'i1', fromCircleId: 'A', toCircleId: 'B', by: 'did:alice', recipient: 'did:bob', policyOf,
    });
    expect(s).toEqual({ ok: true, statusKey: 'circle.share.done', params: { item: 'i1', circle: 'B' } });
  });

  it('shareOut refuses a missing/same-circle target WITHOUT calling the wrapper', async () => {
    const shareItemIntoCircle = vi.fn();
    const noTarget = await shareOut({ itemId: 'i1', fromCircleId: 'A', toCircleId: '', deps: { shareItemIntoCircle } });
    const sameCircle = await shareOut({ itemId: 'i1', fromCircleId: 'A', toCircleId: 'A', deps: { shareItemIntoCircle } });
    expect(shareItemIntoCircle).not.toHaveBeenCalled();
    expect(noTarget.ok).toBe(false);
    expect(noTarget.statusKey).toBe('circle.share.failed');
    expect(sameCircle.ok).toBe(false);
  });

  it('loadSharedRows renders rows from listSharedItems with canonical gating', async () => {
    const listSharedItems = vi.fn(async () => [
      { ref: { sourceCircle: 'A', sourceId: 'i1' }, item: { text: 'canonical plan' } },        // in place → canonical
      { ref: { sourceCircle: 'A', sourceId: 'i2' }, item: { text: 'a copy', sharedCopyOf: 'i9' } }, // copy → not
    ]);
    const rows = await loadSharedRows({ circleId: 'B', recipient: 'did:bob', deps: { listSharedItems } });
    expect(listSharedItems).toHaveBeenCalledWith('B', { recipient: 'did:bob', policyOf: undefined });
    expect(rows.map((r) => [r.label, r.canonical])).toEqual([
      ['canonical plan', true],
      ['a copy', false],
    ]);
  });

  it('stopSharing calls unshareItemFromCircle for a CANONICAL row and returns revoked', async () => {
    const unshareItemFromCircle = vi.fn(async () => ({ ok: true }));
    const policyOf = async () => ({ sharePosture: 'canonical' });
    const row = shareRowFrom({ ref: { sourceCircle: 'A', sourceId: 'i1' }, item: { text: 'canonical plan' } });
    const s = await stopSharing({ row, toCircleId: 'B', recipient: 'did:bob', policyOf, deps: { unshareItemFromCircle } });
    expect(unshareItemFromCircle).toHaveBeenCalledWith({
      itemId: 'i1', fromCircleId: 'A', toCircleId: 'B', recipient: 'did:bob', policyOf,
    });
    expect(s).toEqual({ ok: true, statusKey: 'circle.share.revoked', params: { recipient: 'did:bob', item: 'i1' } });
  });

  it('stopSharing on a NON-canonical (copy) row surfaces not_revocable WITHOUT calling the wrapper', async () => {
    const unshareItemFromCircle = vi.fn();
    const row = shareRowFrom({ ref: { sourceCircle: 'A', sourceId: 'i2' }, item: { text: 'a copy', sharedCopyOf: 'i9' } });
    const s = await stopSharing({ row, toCircleId: 'B', deps: { unshareItemFromCircle } });
    expect(unshareItemFromCircle).not.toHaveBeenCalled();
    expect(s).toEqual({ ok: false, statusKey: 'circle.share.not_revocable', params: undefined });
  });
});

// #26 — the D2 seal-gate COPY fallback surfaces a distinct notice (web≡mobile): a group-key out-of-circle
// share that came back as a re-sealed COPY (`via:'copy'`) maps to `to_person_done_copy` (outside-circle sharing
// differs — not revocable), not the plain `to_person_done`. This is the mobile half of the seal-gate arc, now
// testable since the mobile vitest env was repaired 2026-08-07.
describe('shareToRecipient — the via:copy fallback notice (#26)', () => {
  const base = { itemId: 'i1', fromCircleId: 'A', recipient: 'did:bob', recipientNetworkKey: 'KEY_BOB', name: 'Bob' };

  it('a share that returned via:copy maps to to_person_done_copy', async () => {
    const shareItemToPublishedKey = vi.fn(async () => ({ ok: true, via: 'copy', revocable: false }));
    const s = await shareToRecipient({ ...base, deps: { shareItemToPublishedKey } });
    expect(s).toEqual({ ok: true, statusKey: 'circle.share.to_person_done_copy', params: { item: 'i1', name: 'Bob' } });
  });

  it('a normal in-place grant (no via) maps to the plain to_person_done', async () => {
    const shareItemToPublishedKey = vi.fn(async () => ({ ok: true }));
    const s = await shareToRecipient({ ...base, deps: { shareItemToPublishedKey } });
    expect(s.statusKey).toBe('circle.share.to_person_done');
  });

  it('a failure still maps to to_person_failed', async () => {
    const shareItemToPublishedKey = vi.fn(async () => ({ ok: false, error: 'share-prohibited' }));
    const s = await shareToRecipient({ ...base, deps: { shareItemToPublishedKey } });
    expect(s).toMatchObject({ ok: false, statusKey: 'circle.share.to_person_failed', params: { error: 'share-prohibited' } });
  });
});

// D7 (grants-over-Peer) — the out-of-circle link-warning RULE reaches the RN screen through the SAME shared
// selector web uses. RN screens aren't rendered by vitest, so this pins the seam the screen imports: one rule,
// web ≡ mobile by construction (a mobile-local copy would drift the moment either side changed).
describe('outOfCircleLinkWarning — re-exported for the RN screen (web parity)', () => {
  it('is the SHARED rule, re-exported verbatim from the basis selector', async () => {
    const shared = await import('../../basis/src/v2/shareRecipients.js');
    expect(outOfCircleLinkWarning).toBe(shared.outOfCircleLinkWarning);
  });

  it('warns for a network-key recipient and stays silent when there is nobody to link to', () => {
    const rows = pickableRecipients([{ contactId: 'did:ada', name: 'Ada', pubKey: 'KEY_ADA' }]);
    expect(outOfCircleLinkWarning(rows)).toEqual({ key: 'circle.share.link_warning' });
    expect(outOfCircleLinkWarning([])).toBeNull();
  });
});

