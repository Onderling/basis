/**
 * Where a household bot's agenda links are served is read from the CONTACT it holds: the companion's card names its
 * address and where it serves. No configuration: a bot without such a contact has no link.
 */
import { describe, it, expect } from 'vitest';
import { feedCompanionOf, loadFeedCompanion } from '../../src/v2/feedCompanion.js';

const NODE = 'N'.repeat(43);
const OTHER = 'O'.repeat(43);

describe('the companion a bot\'s links are served by', () => {
  it('the contact whose card says where it serves: its address and that base', () => {
    expect(feedCompanionOf([
      { webid: 'telegram:1', displayName: 'Bea' },
      { webid: NODE, peerAddr: NODE, serves: 'https://relay.example.org/' },
    ])).toEqual({ node: NODE, base: 'https://relay.example.org' });
  });

  it('none: no contact serves, one hidden, one with no address that is a node, one serving no http address', () => {
    expect(feedCompanionOf([])).toBeNull();
    expect(feedCompanionOf([{ webid: NODE, peerAddr: NODE }])).toBeNull();
    expect(feedCompanionOf([{ webid: NODE, peerAddr: NODE, serves: 'https://r.example', hidden: true }])).toBeNull();
    expect(feedCompanionOf([{ webid: 'https://id.example/x', serves: 'https://r.example' }])).toBeNull();
    expect(feedCompanionOf([{ webid: NODE, peerAddr: NODE, serves: 'ftp://r.example' }])).toBeNull();
    expect(feedCompanionOf(null)).toBeNull();
  });

  it('several: the one added last (a household moved its companion)', () => {
    expect(feedCompanionOf([
      { webid: OTHER, peerAddr: OTHER, serves: 'https://old.example' },
      { webid: NODE, peerAddr: NODE, serves: 'https://new.example' },
    ])).toEqual({ node: NODE, base: 'https://new.example' });
  });

  it('read through the waist, at the moment it is needed', async () => {
    const book = [];
    const callSkill = async (app, op) => (app === 'stoop' && op === 'listContacts' ? { contacts: book } : null);
    expect(await loadFeedCompanion({ callSkill })).toBeNull();
    book.push({ webid: NODE, peerAddr: NODE, serves: 'https://relay.example.org' });
    expect(await loadFeedCompanion({ callSkill })).toEqual({ node: NODE, base: 'https://relay.example.org' });
    expect(await loadFeedCompanion({ callSkill: async () => { throw new Error('down'); } })).toBeNull();
  });
});
