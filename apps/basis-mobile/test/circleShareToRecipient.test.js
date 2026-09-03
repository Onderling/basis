/**
 * circleShareScreen — the out-of-circle recipient share (objective L · Phase 2 · invariant #2 web≡mobile).
 * Vitest can't render RN components, so this exercises the PORTABLE model behind CircleShareScreen and proves:
 *   • the screen model uses the SAME shared `pickableRecipients` selector web's picker uses (web≡mobile, no
 *     mobile fork) — asserted by identity against the shared module,
 *   • `shareToRecipient` is a thin adapter that calls `shareItemToPublishedKey` with the contact's published
 *     network key as `recipientNetworkKey` (the exact wiring the RN Pressable triggers),
 *   • it gates a missing/same-circle target and a keyless recipient WITHOUT touching the wrapper.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  shareToRecipient, pickableRecipients as screenPickable,
} from '../src/core/circleShareScreen.js';
import { pickableRecipients as sharedPickable } from '../../basis/src/v2/shareRecipients.js';
import { stoopContactToRow, peerToContactRow } from '../../basis/src/v2/contactsSource.js';

describe('circle share screen — out-of-circle recipient (web≡mobile)', () => {
  it('re-exports the ONE shared selector (no mobile fork of pickableRecipients)', () => {
    expect(screenPickable).toBe(sharedPickable);
  });

  it('the selector projects the Contacten roster to recipient rows (same as web)', () => {
    const contacts = [
      stoopContactToRow({ webid: 'did:dave', displayName: 'Dave', pubKey: 'KEY_DAVE', trustLevel: 'vertrouwd' }),
      peerToContactRow({ url: 'https://bot/agent', name: 'URL Bot' }),   // no key → excluded
    ];
    expect(screenPickable(contacts)).toEqual([
      { id: 'did:dave', name: 'Dave', recipientNetworkKey: 'KEY_DAVE', trustLevel: 'vertrouwd' },
    ]);
  });

  it('shareToRecipient calls shareItemToPublishedKey with the contact\'s pubKey as recipientNetworkKey', async () => {
    const shareItemToPublishedKey = vi.fn(async () => ({ ok: true, ref: {} }));
    const policyOf = async () => ({ sharePosture: 'canonical' });
    // Take the recipient row straight from the shared selector — the same row the RN Pressable hands in.
    const [dave] = screenPickable([stoopContactToRow({ webid: 'did:dave', displayName: 'Dave', pubKey: 'KEY_DAVE' })]);
    const s = await shareToRecipient({
      itemId: 'i1', fromCircleId: 'A', toCircleId: '  B  ',
      recipient: dave.id, recipientNetworkKey: dave.recipientNetworkKey, name: dave.name,
      by: 'did:alice', policyOf, deps: { shareItemToPublishedKey },
    });
    expect(shareItemToPublishedKey).toHaveBeenCalledWith({
      itemId: 'i1', fromCircleId: 'A', toCircleId: 'B', by: 'did:alice',
      recipient: 'did:dave', recipientNetworkKey: 'KEY_DAVE', verify: undefined, policyOf,
    });
    expect(s).toEqual({ ok: true, statusKey: 'circle.share.to_person_done', params: { item: 'i1', name: 'Dave' } });
  });

  it('gates a same-circle target and a keyless recipient WITHOUT calling the wrapper', async () => {
    const shareItemToPublishedKey = vi.fn();
    const base = { itemId: 'i1', fromCircleId: 'A', recipient: 'did:dave', recipientNetworkKey: 'KEY', deps: { shareItemToPublishedKey } };
    expect((await shareToRecipient({ ...base, toCircleId: 'A' })).ok).toBe(false);          // same circle
    expect((await shareToRecipient({ ...base, toCircleId: 'B', recipientNetworkKey: '' })).ok).toBe(false);  // no key
    expect(shareItemToPublishedKey).not.toHaveBeenCalled();
  });

  it('a MISSING toCircleId is now a valid person-share — the wrapper IS called with toCircleId undefined', async () => {
    const shareItemToPublishedKey = vi.fn(async () => ({ ok: true, ref: {} }));
    const base = { itemId: 'i1', fromCircleId: 'A', recipient: 'did:dave', recipientNetworkKey: 'KEY', deps: { shareItemToPublishedKey } };
    const s = await shareToRecipient({ ...base, toCircleId: '' });   // empty target ⇒ a pure person-share
    expect(s.ok).toBe(true);
    expect(shareItemToPublishedKey).toHaveBeenCalledTimes(1);
    expect(shareItemToPublishedKey.mock.calls[0][0]).toMatchObject({ itemId: 'i1', fromCircleId: 'A', toCircleId: undefined, recipient: 'did:dave' });
  });
});


describe('the person-share affordance is gated by ONE shared predicate on both shells (web≡mobile)', () => {
  const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  it("mobile's share screen paints the out-of-circle block only when `outOfCircleShareOffered(policy)`", () => {
    const s = src('../src/screens/v2/CircleShareScreen.js');
    expect(s).toMatch(/import \{ outOfCircleShareOffered \} from '.*basis\/src\/v2\/circleShare\.js'/);
    expect(s).toContain('outOfCircleShareOffered(policy)');
  });
  it("web's /sharewith door asks the same predicate before opening the picker", () => {
    const s = src('../../basis/web/v2/circleApp.js');
    expect(s).toContain('outOfCircleShareOffered(await _circlePolicy(id))');
  });
});
