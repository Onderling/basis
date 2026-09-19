/**
 * contactsSource — the Contacten roster from a PeerGraph (feedback-extension).
 * Drives the real @onderling/core PeerGraph so the mapping + ordering match what
 * the live agent feeds the roster.
 */
import { describe, it, expect } from 'vitest';

import { PeerGraph } from '@onderling/core';
import {
  listContacts, peerToContactRow, stoopContactToRow, mergeContacts, splitShownHidden,
} from '../src/v2/contactsSource.js';

describe('peerToContactRow', () => {
  it('maps an a2a bot peer → a bot row with skill count + A2A url', () => {
    const row = peerToContactRow({
      type: 'a2a', url: 'https://bot.example', name: 'Feedback bot',
      skills: [{ id: 'summarise' }, { id: 'sentiment' }], reachable: true,
    });
    expect(row).toMatchObject({
      contactId: 'https://bot.example', name: 'Feedback bot', isBot: true,
      skillCount: 2, reachable: true, peerAddr: null, url: 'https://bot.example',
    });
  });

  it('carries the contact\'s declared pre-send floor onto the row (null when undeclared)', () => {
    expect(peerToContactRow({ type: 'a2a', url: 'https://bot.example', name: 'B', redact: 'pre-send' }).redact).toBe('pre-send');
    expect(peerToContactRow({ type: 'native', pubKey: 'P', name: 'A' }).redact).toBeNull();
  });

  it('maps a native peer → a person row with a peerAddr (pubKey)', () => {
    const row = peerToContactRow({ type: 'native', pubKey: 'PUBKEY1', name: 'Alice', reachable: true });
    expect(row).toMatchObject({ contactId: 'PUBKEY1', isBot: false, peerAddr: 'PUBKEY1', url: null });
  });

  it('treats a skill-bearing native/hybrid peer as a bot', () => {
    const row = peerToContactRow({ type: 'hybrid', pubKey: 'K', skills: [{ id: 'x' }] });
    expect(row.isBot).toBe(true);
    expect(row.peerAddr).toBe('K');
  });

  it('drops a peer with neither pubKey nor url', () => {
    expect(peerToContactRow({ type: 'a2a', name: 'ghost' })).toBeNull();
  });
});

describe('listContacts', () => {
  it('returns bots first, then people, each alphabetical', async () => {
    const peers = new PeerGraph();
    await peers.upsert({ type: 'native', pubKey: 'k-bob', name: 'Bob' });
    await peers.upsert({ type: 'a2a', url: 'https://b.example', name: 'Beta bot', skills: [{ id: 's' }] });
    await peers.upsert({ type: 'native', pubKey: 'k-ann', name: 'Ann' });
    await peers.upsert({ type: 'a2a', url: 'https://a.example', name: 'Alpha bot', skills: [{ id: 's' }] });

    const rows = await listContacts(peers);
    expect(rows.map((r) => r.name)).toEqual(['Alpha bot', 'Beta bot', 'Ann', 'Bob']);
    expect(rows.slice(0, 2).every((r) => r.isBot)).toBe(true);
    expect(rows.slice(2).every((r) => !r.isBot)).toBe(true);
  });

  it('null/!graph → empty (inert without a peer graph)', async () => {
    expect(await listContacts(null)).toEqual([]);
    expect(await listContacts({})).toEqual([]);
  });

  it('a member\'s PER-CIRCLE address is not a second contact — an alias is skipped, the person stays (2026-09-13)', async () => {
    // Every send populates the graph with the address it reached, so a member's per-circle address
    // arrives as a bare record beside their own. Shown, it is a raw key named as a person, and a DM to
    // it is refused on arrival (the sender's canonical key inside a circle). Which of the two rows came
    // first depended on the key bytes: the flaky DM of two-relays STEP4.
    const peers = new PeerGraph();
    await peers.upsert({ type: 'native', pubKey: 'k-ann', name: 'Ann' });
    await peers.upsert({ pubKey: 'ann-in-huis', transports: { relay: { address: 'ann-in-huis' } } });   // reached, never introduced
    await peers.upsert({ pubKey: 'k-cas' });   // a bare person the device only ever greeted: still a person
    const identityOf = (a) => (a === 'ann-in-huis' ? 'k-ann' : null);
    expect((await listContacts(peers, { identityOf })).map((r) => r.contactId)).toEqual(['k-ann', 'k-cas']);
    // Without the read, nothing is hidden — the roster cannot guess which record is an alias.
    expect((await listContacts(peers)).map((r) => r.contactId).sort()).toEqual(['ann-in-huis', 'k-ann', 'k-cas']);
    // A read that throws hides nothing either.
    expect((await listContacts(peers, { identityOf: () => { throw new Error('x'); } })).length).toBe(3);
  });
  it('I am not my own contact: my person-key address, my profile key and my devices\' addresses are never rows (2026-09-19)', async () => {
    // Measured in the feedback walk: the maker's own PERSON address (the one every device of theirs speaks as to
    // its siblings — the box's roster-seed parcel, the carried turns) was a nameless row on the maker's Contacten,
    // sorted by key bytes, and an answer sent to it went nowhere. Frits' phone: "a random string named contact".
    const peers = new PeerGraph();
    await peers.upsert({ type: 'native', pubKey: 'k-ann', name: 'Ann' });
    await peers.upsert({ pubKey: 'me-as-person', transports: { relay: { address: 'me-as-person' } } });   // my own person address, greeted by my box
    await peers.upsert({ pubKey: 'me-profile' });                                                         // my static profile key
    await peers.upsert({ pubKey: 'my-box-in-thuis' });                                                    // my box's per-circle address, reached by the fan
    const own = () => ['me-as-person', 'me-profile', 'my-box-in-thuis'];
    expect((await listContacts(peers, { ownAddresses: own })).map((r) => r.contactId)).toEqual(['k-ann']);
    // A device that cannot say what its own addresses are hides nothing (the honest degradation).
    expect((await listContacts(peers)).length).toBe(4);
    expect((await listContacts(peers, { ownAddresses: () => { throw new Error('x'); } })).length).toBe(4);
  });
});

describe('stoopContactToRow (S1 #2 — member directory)', () => {
  it('maps a ContactBook person → a non-bot row with trust + tags + peerAddr', () => {
    const row = stoopContactToRow({
      webid: 'https://alice.example/me', pubKey: 'PKALICE', displayName: 'Alice',
      trustLevel: 'vertrouwd', tags: ['buur', 'klusser'],
    });
    expect(row).toMatchObject({
      contactId: 'https://alice.example/me', name: 'Alice', isBot: false,
      peerAddr: 'PKALICE', source: 'contact', trustLevel: 'vertrouwd', tags: ['buur', 'klusser'],
    });
  });

  it('falls back name → handle → webid; drops an entry with no id', () => {
    expect(stoopContactToRow({ webid: 'w', handle: 'bob' }).name).toBe('bob');
    expect(stoopContactToRow({ pubKey: 'k' }).name).toBe('k');
    expect(stoopContactToRow({})).toBeNull();
  });

  it('a contact from a CARD is written to at the address the card names — never at their device key', () => {
    // 2026-09-18, the seeded alpha contact: the card carries the person's address (`peerAddr`, the profile
    // address every device of theirs registers on the relay) AND the sharing device's own key (`pubKey`, an
    // enrolled device's delegation key, which is no address at all). The row took `pubKey` first — a habit
    // from the days when a contact's pubKey WAS its mesh address — so every message to the seeded contact
    // went to a key nobody holds on any relay, and sat "sealed to the device only" forever. Measured on the
    // published app: the thread opened on `b5_-JbBf…` while the card said `LE1n…`.
    const row = stoopContactToRow({ webid: 'LE1n', pubKey: 'b5_-JbBf-device-key', peerAddr: 'LE1n', displayName: 'Wilfred' });
    expect(row.peerAddr, 'the address the card names').toBe('LE1n');
    // A legacy book entry with only a pubKey (the mesh-era shape) still routes by it.
    expect(stoopContactToRow({ webid: 'w2', pubKey: 'MESHKEY' }).peerAddr).toBe('MESHKEY');
  });
});

describe('mergeContacts — the peer graph wins the row, the book keeps the NAME', () => {
  it('a peer-graph row that only knows the address does not rename the person to their key', () => {
    // Frits' phone, 2026-09-19: "Wilfred is gone and now I only have a random-string contact". Sending the
    // first message put the recipient in the peer graph (address only, no name); the merge let the peer row
    // win whole, so the book's name — the one thing the card gave — was replaced by the key.
    const peerRows = [{ contactId: 'LE1n', name: 'LE1n', isBot: false, peerAddr: 'LE1n' }];
    const stoopRows = [{ contactId: 'LE1n', name: 'Wilfred', isBot: false, source: 'contact', peerAddr: 'LE1n', trustLevel: 'bekend' }];
    const [row] = mergeContacts(peerRows, stoopRows);
    expect(row.name, 'the card\'s name stands when the graph has none').toBe('Wilfred');
    expect(row.trustLevel).toBe('bekend');
    // A peer row that HAS a name (a bot, a peer that introduced itself) keeps it.
    const [named] = mergeContacts([{ contactId: 'LE1n', name: 'Wil the bot', isBot: true }], stoopRows);
    expect(named.name).toBe('Wil the bot');
  });
});

describe('a HIDDEN contact (L106) — the book\'s mark survives the merge, and the roster splits on it', () => {
  it('the book\'s hidden mark rides the merged row, whatever the peer graph says', () => {
    const stoopRows = [{ contactId: 'LE1n', name: 'Wilfred', isBot: false, source: 'contact', peerAddr: 'LE1n', hidden: true }];
    const [row] = mergeContacts([{ contactId: 'LE1n', name: 'LE1n', isBot: false, peerAddr: 'LE1n' }], stoopRows);
    expect(row.hidden, 'a graph row never un-hides what the book hid').toBe(true);
    const [alone] = mergeContacts([], stoopRows);
    expect(alone.hidden).toBe(true);
    const [shown] = mergeContacts([], [{ ...stoopRows[0], hidden: false }]);
    expect(shown.hidden).toBe(false);
  });
  it('stoopContactToRow carries the mark; splitShownHidden folds the hidden rows away', () => {
    const row = stoopContactToRow({ webid: 'w', displayName: 'W', hidden: true, hiddenAt: 5 });
    expect(row.hidden).toBe(true);
    expect(stoopContactToRow({ webid: 'v', displayName: 'V' }).hidden).toBe(false);
    const { shown, hidden } = splitShownHidden([row, { contactId: 'v', name: 'V', hidden: false }, { contactId: 'b', name: 'Bot', isBot: true }]);
    expect(shown.map((r) => r.contactId)).toEqual(['v', 'b']);
    expect(hidden.map((r) => r.contactId)).toEqual(['w']);
  });
});

describe('mergeContacts (S1 #2)', () => {
  it('merges peer + stoop rows, de-dupes by contactId (peer wins), bots first', () => {
    const peerRows = [
      { contactId: 'bot1', name: 'Bot One', isBot: true },
      { contactId: 'shared', name: 'Peer view', isBot: false, peerAddr: 'PK' },
    ];
    const stoopRows = [
      { contactId: 'shared', name: 'Contact view', isBot: false, source: 'contact' },
      { contactId: 'alice', name: 'Alice', isBot: false, source: 'contact' },
    ];
    const merged = mergeContacts(peerRows, stoopRows);
    expect(merged.map((r) => r.contactId)).toEqual(['bot1', 'alice', 'shared']); // bot first, then people A-Z
    // the peer entry wins on collision (keeps a bot's skills / live peer data)
    expect(merged.find((r) => r.contactId === 'shared').name).toBe('Peer view');
  });

  it('handles empty inputs', () => {
    expect(mergeContacts()).toEqual([]);
    expect(mergeContacts([{ contactId: 'a', name: 'A', isBot: false }], [])).toHaveLength(1);
  });
});
