/**
 * shareRecipients (objective L · Phase 2) — the SHARED (web≡mobile) selector behind the out-of-circle
 * recipient picker. Proves it turns the Contacten roster rows (`peerToContactRow`/`stoopContactToRow`) into
 * the recipient rows `shareItemToPublishedKey` targets:
 *   • a contact WITH a published network key (peerAddr / pubKey) → a pickable recipient whose
 *     `recipientNetworkKey` IS that key (passed straight through to shareItemToPublishedKey),
 *   • a contact WITHOUT a network key (a URL-only A2A bot) → EXCLUDED (nothing to derive a sealing key from),
 *   • trustLevel is surfaced when present (the light attestation seam), de-dup by id.
 */
import { describe, it, expect } from 'vitest';
import { peerToContactRow, stoopContactToRow } from '../../src/v2/contactsSource.js';
import { pickableRecipients, outOfCircleLinkWarning } from '../../src/v2/shareRecipients.js';

describe('pickableRecipients — the out-of-circle recipient selector', () => {
  it('maps contacts that carry a network key to recipient rows; the key IS recipientNetworkKey', () => {
    // Real roster rows: a stoop ContactBook person (peerAddr from pubKey + trustLevel) and a discovered peer.
    const person = stoopContactToRow({ webid: 'did:dave', displayName: 'Dave', pubKey: 'KEY_DAVE', trustLevel: 'vertrouwd' });
    const peer   = peerToContactRow({ pubKey: 'KEY_PEER', name: 'Peer One' });
    const rows = pickableRecipients([person, peer]);
    expect(rows).toEqual([
      { id: 'did:dave', name: 'Dave', recipientNetworkKey: 'KEY_DAVE', trustLevel: 'vertrouwd' },
      { id: 'KEY_PEER', name: 'Peer One', recipientNetworkKey: 'KEY_PEER' },
    ]);
    // The recipientNetworkKey is exactly the contact's published network address — what the op derives from.
    expect(rows[0].recipientNetworkKey).toBe('KEY_DAVE');
  });

  it('EXCLUDES a contact with no network key (a URL-only A2A bot has nothing to grant a key to)', () => {
    const urlBot = peerToContactRow({ url: 'https://bot.example/agent', name: 'URL Bot' });   // no pubKey → peerAddr null
    expect(urlBot.peerAddr).toBeNull();
    expect(pickableRecipients([urlBot])).toEqual([]);
    // Mixed: only the keyed one survives.
    const keyed = stoopContactToRow({ webid: 'did:ann', displayName: 'Ann', pubKey: 'KEY_ANN' });
    expect(pickableRecipients([urlBot, keyed])).toEqual([
      { id: 'did:ann', name: 'Ann', recipientNetworkKey: 'KEY_ANN' },
    ]);
  });

  it('accepts a raw pubKey field, omits trustLevel when absent, and de-dupes by id', () => {
    const raw = { contactId: 'c1', name: 'Raw', pubKey: 'KEY_RAW' };            // pubKey field directly
    const dupe = { contactId: 'c1', name: 'Raw again', peerAddr: 'KEY_RAW' };   // same id → dropped
    const rows = pickableRecipients([raw, dupe]);
    expect(rows).toEqual([{ id: 'c1', name: 'Raw', recipientNetworkKey: 'KEY_RAW' }]);
    expect('trustLevel' in rows[0]).toBe(false);
  });

  it('is defensive: empty / non-array / null entries yield no rows', () => {
    expect(pickableRecipients()).toEqual([]);
    expect(pickableRecipients(null)).toEqual([]);
    expect(pickableRecipients([null, undefined, {}])).toEqual([]);
  });
});

// D7 (grants-over-Peer) — the out-of-circle LINK warning rule. Informed consent before the pick: granting
// by published network key is a deliberate 1:1 link both sides can see. The RULE lives in the shared
// selector so web and mobile can never disagree about when to warn.
describe('outOfCircleLinkWarning — warn iff the pick grants by network key', () => {
  it('returns the locale key when any recipient would be granted by network key', () => {
    const rows = pickableRecipients([peerToContactRow({ pubKey: 'KEY_A', name: 'Ada' })]);
    expect(outOfCircleLinkWarning(rows)).toEqual({ key: 'circle.share.link_warning' });
  });

  it('returns null when there is nobody to warn about (empty / no network key)', () => {
    expect(outOfCircleLinkWarning([])).toBeNull();
    expect(outOfCircleLinkWarning()).toBeNull();
    // A row with no network key carries no new link — it must NOT warn (the rule, not the list length).
    expect(outOfCircleLinkWarning([{ id: 'x', name: 'No Key' }])).toBeNull();
  });

  it('is a WARNING, not a gate: it never filters or reorders the pickable recipients', () => {
    const rows = pickableRecipients([
      peerToContactRow({ pubKey: 'KEY_A', name: 'Ada' }),
      peerToContactRow({ pubKey: 'KEY_B', name: 'Bo' }),
    ]);
    expect(outOfCircleLinkWarning(rows)).toBeTruthy();
    expect(rows.map((r) => r.name)).toEqual(['Ada', 'Bo']);   // unchanged — nothing is blocked
  });
});
