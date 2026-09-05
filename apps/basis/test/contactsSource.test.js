/**
 * contactsSource — the Contacten roster from a PeerGraph (feedback-extension).
 * Drives the real @onderling/core PeerGraph so the mapping + ordering match what
 * the live agent feeds the roster.
 */
import { describe, it, expect } from 'vitest';

import { PeerGraph } from '@onderling/core';
import {
  listContacts, peerToContactRow, stoopContactToRow, mergeContacts,
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
