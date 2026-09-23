/**
 * contactsSource — the Contacten roster from a PeerGraph (feedback-extension).
 * Drives the real @onderling/core PeerGraph so the mapping + ordering match what
 * the live agent feeds the roster.
 */
import { describe, it, expect } from 'vitest';

import { PeerGraph } from '@onderling/core';
import {
  listContacts, peerToContactRow, stoopContactToRow, mergeContacts, splitShownHidden, nameContactsFromRosters, loadContactRoster, markLookalikes, markRenames, makeContactNameStore,
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

describe('THE BOOK READS THE ROSTER (2026-09-21) — a contact with a pair roster here is named by what they SAID on it', () => {
  // Fable's answer 4 on member-props: the one road for a name is the member's own signed statement on the membership
  // lane, folded on every device; the card names a contact only until their roster says something. Every device of
  // the person is in every pair circle since the siblings follow a circle, so this holds on the laptop as on the box.
  const book = (over) => stoopContactToRow({ webid: 'bea', pubKey: 'bea', displayName: 'Bea (card)', pairCircleId: 'pair-ab', ...over });
  it('the roster\'s `said` displayName wins, then its handle; the card stays where the roster says nothing; a bot is untouched', async () => {
    const rosters = { 'pair-ab': [{ webid: 'bea', said: { displayName: 'Beatrix', handle: 'bea' } }] };
    const rosterRow = async (cid, webid) => (rosters[cid] ?? []).find((m) => m.webid === webid) ?? null;
    const [named] = await nameContactsFromRosters([book()], { rosterRow });
    expect(named.name).toBe('Beatrix');
    expect(named.namedBy).toBe('roster');
    rosters['pair-ab'][0].said = { handle: 'bea-h' };
    expect((await nameContactsFromRosters([book()], { rosterRow }))[0].name).toBe('bea-h');
    rosters['pair-ab'][0].said = undefined;                       // the roster row exists, the lane holds nothing yet
    expect((await nameContactsFromRosters([book()], { rosterRow }))[0].name, 'the card is the fallback').toBe('Bea (card)');
    expect((await nameContactsFromRosters([book({ pairCircleId: undefined })], { rosterRow }))[0].name, 'no pair roster: the card').toBe('Bea (card)');
    const bot = peerToContactRow({ pubKey: 'bot', name: 'Wilfred', type: 'a2a', skills: [{ id: 's' }] });
    expect((await nameContactsFromRosters([{ ...bot, pairCircleId: 'pair-ab' }], { rosterRow }))[0].name).toBe('Wilfred');
  });
  it('a roster that cannot be read leaves the row as it was; without the seam the rows pass through', async () => {
    const [r] = await nameContactsFromRosters([book()], { rosterRow: async () => { throw new Error('no roster'); } });
    expect(r.name).toBe('Bea (card)');
    expect(await nameContactsFromRosters([book()], {})).toEqual([book()]);
  });
  it('re-sorts by the roster name (Contacten is alphabetical on what is painted)', async () => {
    const rows = [stoopContactToRow({ webid: 'a', displayName: 'Zed', pairCircleId: 'p-a' }), stoopContactToRow({ webid: 'b', displayName: 'Mia' })];
    const named = await nameContactsFromRosters(rows, { rosterRow: async (cid) => (cid === 'p-a' ? { webid: 'a', said: { displayName: 'Aaf' } } : null) });
    expect(named.map((r) => r.name)).toEqual(['Aaf', 'Mia']);
  });
  it('loadContactRoster composes the whole Contacten read for every shell: graph + book, merged, named from the rosters', async () => {
    const g = new PeerGraph();
    await g.upsert({ id: 'bea', pubKey: 'bea', type: 'native', name: 'bea' });
    const calls = [];
    const callSkill = async (app, op, args) => {
      calls.push(op);
      if (op === 'listContacts') return { contacts: [{ webid: 'bea', pubKey: 'bea', displayName: 'Bea (card)', pairCircleId: 'pair-ab' }] };
      if (op === 'listGroupMembers') return { members: args.groupId === 'pair-ab' ? [{ webid: 'bea', said: { displayName: 'Beatrix' } }] : [] };
      return null;
    };
    const rows = await loadContactRoster({ peerGraph: g, agent: { identityOfAddress: () => null, ownAddresses: () => [] }, callSkill });
    expect(rows.map((r) => [r.contactId, r.name, r.source])).toEqual([['bea', 'Beatrix', 'contact']]);
    expect(calls).toEqual(['listContacts', 'listGroupMembers']);
  });
});

describe('THE NAMELESS ROW COMES BACK (2026-09-22, the delete/hide note §6a-3) — shown, named by the ladder, never folded for a message that arrived', () => {
  // Hiding a sender the book never held upserts `{ webid, pubKey: webid, hidden: true }` (ContactBook.setHidden). When
  // they write again the shell unhides the row (`onReturned` → setContactHidden false — the channel's seam, tested in
  // contactThreadPersist). What is painted then is decided HERE: the row is SHOWN and named by the ladder — what they
  // said on the pair roster → the card's name → their key. Frits 2026-09-19: "their next message brings them back";
  // a person who never gave a name is still a person who just wrote, so the row is never left in the fold for want
  // of a name (L108's "random string" was my OWN addresses painted as people — fixed at the source, a different thing).
  const returned = (over = {}) => ({ webid: 'x9k', pubKey: 'x9k', hidden: false, hiddenAt: 5, ...over });   // the book row after the return
  const g = async () => { const pg = new PeerGraph(); await pg.upsert({ id: 'x9k', pubKey: 'x9k', type: 'native', name: 'x9k' }); return pg; };
  const skills = (book, roster = []) => async (app, op, args) => (op === 'listContacts' ? { contacts: [book] } : op === 'listGroupMembers' ? { members: roster } : null);
  it('named by what they SAID on the pair roster', async () => {
    const rows = await loadContactRoster({ peerGraph: await g(), agent: null, callSkill: skills(returned({ pairCircleId: 'pair-x' }), [{ webid: 'x9k', said: { displayName: 'Xander' } }]) });
    const { shown, hidden } = splitShownHidden(rows);
    expect(shown.map((r) => [r.contactId, r.name])).toEqual([['x9k', 'Xander']]);
    expect(hidden).toEqual([]);
  });
  it('else by the CARD\'s name (the book row the card wrote)', async () => {
    const rows = await loadContactRoster({ peerGraph: await g(), agent: null, callSkill: skills(returned({ displayName: 'Xander (card)', pairCircleId: 'pair-x' }), [{ webid: 'x9k' }]) });
    const { shown, hidden } = splitShownHidden(rows);
    expect(shown.map((r) => r.name)).toEqual(['Xander (card)']);
    expect(hidden).toEqual([]);
  });
  it('else by their KEY — shown all the same; a message that arrived is never behind the fold', async () => {
    const rows = await loadContactRoster({ peerGraph: await g(), agent: null, callSkill: skills(returned()) });
    const { shown, hidden } = splitShownHidden(rows);
    expect(shown.map((r) => [r.contactId, r.name, r.hidden])).toEqual([['x9k', 'x9k', false]]);
    expect(hidden).toEqual([]);
  });
  it('and while still hidden (no message yet), the same nameless row sits in the fold — the mark, not the name, decides', async () => {
    const rows = await loadContactRoster({ peerGraph: await g(), agent: null, callSkill: skills(returned({ hidden: true })) });
    const { shown, hidden } = splitShownHidden(rows);
    expect(shown).toEqual([]);
    expect(hidden.map((r) => r.contactId)).toEqual(['x9k']);
  });
});

describe('TELLING TWO CONTACTS APART (L116, 2026-09-23) — the lookalike name', () => {
  // Since the book reads the roster, a contact is named by what THEY said on their pair roster — so a
  // contact can rename themselves to the name of another of your contacts. Two rows "Frits", one an impostor,
  // and the thread opens under the name. The gate is cheap and belongs to the projection, not to a shell: when
  // two or more SHOWN rows share a display name, every one of them carries the handle (or the key's last four)
  // beside it — all of them, not only the newcomer, because a person cannot guess which one moved.
  const row = (contactId, name, over = {}) => ({ contactId, name, isBot: false, source: 'contact', hidden: false, ...over });
  it('marks every row of a colliding set, never a unique one; a bot is left alone', () => {
    const rows = markLookalikes([
      row('aaaa1111', 'Frits', { handle: 'frits' }),
      row('bbbb2222', 'Frits'),
      row('cccc3333', 'Bea', { handle: 'bea' }),
      row('dddd4444', 'Frits', { isBot: true }),
    ]);
    const by = Object.fromEntries(rows.map((r) => [r.contactId, r]));
    expect(by.aaaa1111.lookalike, 'the handle tells them apart where there is one').toBe('frits');
    expect(by.bbbb2222.lookalike, 'else the key says which one this is').toBe('2222');
    expect(by.cccc3333.lookalike, 'a name nobody else uses needs nothing').toBeUndefined();
    expect(by.dddd4444.lookalike, 'a bot is not a person and is named by its registry').toBeUndefined();
  });
  it('compares the name as it is PAINTED — case and surrounding space do not make two names different', () => {
    const rows = markLookalikes([row('aaaa1111', 'Frits'), row('bbbb2222', ' frits ')]);
    expect(rows.every((r) => r.lookalike)).toBe(true);
  });
  it('a hidden row is not on screen, so it collides with nobody', () => {
    const rows = markLookalikes([row('aaaa1111', 'Frits'), row('bbbb2222', 'Frits', { hidden: true })]);
    expect(rows.find((r) => r.contactId === 'aaaa1111').lookalike).toBeUndefined();
  });
});

describe('A CONTACT WHO RENAMED THEMSELVES (L116) — "was: …" until you have seen it', () => {
  // The rename lands from the roster with no announcement of any kind; a row simply reads differently the next
  // time you look. So the row says what it was, until the thread is opened — the same seen-mark the unread
  // count already keeps per device.
  const row = (contactId, name) => ({ contactId, name, isBot: false, source: 'contact', hidden: false });
  it('carries the previous name once the lane-borne name differs from what this device last saw', () => {
    const seen = { aaaa1111: { name: 'Frits', at: 1 } };
    const [r] = markRenames([row('aaaa1111', 'Frits de Boer')], { lastSeenNames: seen });
    expect(r.wasName).toBe('Frits');
  });
  it('says nothing when the name is unchanged, when this device never saw one, or once it is seen again', () => {
    expect(markRenames([row('a', 'Frits')], { lastSeenNames: { a: { name: 'Frits', at: 1 } } })[0].wasName).toBeUndefined();
    expect(markRenames([row('a', 'Frits')], { lastSeenNames: {} })[0].wasName, 'a first sighting is not a rename').toBeUndefined();
    expect(markRenames([row('a', 'Frits de Boer')], { lastSeenNames: { a: { name: 'Frits de Boer', at: 2 } } })[0].wasName).toBeUndefined();
  });
  it('a store remembers what was painted, and clears the marker when the thread is opened', async () => {
    const mem = new Map();
    const store = makeContactNameStore({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v); } });
    await store.remember([row('a', 'Frits'), row('b', 'Bea')]);
    expect((await store.read()).a.name).toBe('Frits');
    const [r] = markRenames([row('a', 'Frits de Boer')], { lastSeenNames: await store.read() });
    expect(r.wasName).toBe('Frits');
    await store.seen('a', 'Frits de Boer');                       // the thread was opened
    expect(markRenames([row('a', 'Frits de Boer')], { lastSeenNames: await store.read() })[0].wasName).toBeUndefined();
  });
});

describe('loadContactRoster — the name markers ride the one read (L116)', () => {
  it('marks lookalikes and renames, and remembers what it painted', async () => {
    const g = new PeerGraph();
    const mem = new Map();
    const names = makeContactNameStore({ getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => { mem.set(k, v); } });
    await names.seen('aa11', 'Frits');
    const callSkill = async (app, op) => (op === 'listContacts'
      ? { contacts: [{ webid: 'aa11', displayName: 'Frits de Boer' }, { webid: 'bb22', displayName: 'Bea' }, { webid: 'cc33', displayName: 'Bea' }] }
      : null);
    const rows = await loadContactRoster({ peerGraph: g, agent: null, callSkill, names });
    const by = Object.fromEntries(rows.map((r) => [r.contactId, r]));
    expect(by.aa11.wasName, 'the row says what it was').toBe('Frits');
    expect(by.bb22.lookalike && by.cc33.lookalike, 'both Beas are told apart').toBeTruthy();
    expect((await names.read()).bb22.name, 'a row with no marker is remembered as painted').toBe('Bea');
    expect((await names.read()).aa11.name, 'a row still to be acknowledged keeps the OLD name').toBe('Frits');
  });
});
