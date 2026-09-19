/**
 * seededContact — the shipped contact: added once through the scanned-card path, never twice, never
 * from a card that is not one, and nothing at all when no card is configured.
 */
import { describe, it, expect } from 'vitest';
import { seedContactCard, seededContactWebid } from '../../src/v2/seededContact.js';

const card = (obj) => 'onderling-contact://' + Buffer.from(JSON.stringify(obj)).toString('base64url');
const FRITS = card({ webid: 'frits-key', pubKey: 'frits-key', displayName: 'Frits', relays: ['wss://relay.onderling.org'] });

function rig({ known = [] } = {}) {
  const calls = [];
  const callSkill = async (app, op, args) => {
    calls.push({ app, op, args });
    if (op === 'listContacts') return { items: known.map((webid) => ({ webid })) };
    if (op === 'addContactFromQr') return { contact: { webid: 'frits-key' } };
    return {};
  };
  return { calls, callSkill };
}

describe('the seeded contact', () => {
  it('reads the card\'s webid, and refuses what is not a card', () => {
    expect(seededContactWebid(FRITS)).toBe('frits-key');
    expect(seededContactWebid('onderling-enroll://abc')).toBeNull();
    expect(seededContactWebid('onderling-contact://')).toBeNull();
    expect(seededContactWebid('onderling-contact://!!!')).toBeNull();
    expect(seededContactWebid(card({ displayName: 'no webid' }))).toBeNull();
  });

  it('adds the person through the scanned-card path when the card is set and they are not in the book', async () => {
    const r = rig();
    expect(await seedContactCard({ payload: FRITS, callSkill: r.callSkill })).toEqual({ seeded: true, webid: 'frits-key' });
    expect(r.calls.map((c) => c.op)).toEqual(['listContacts', 'addContactFromQr']);
    expect(r.calls[1].args).toEqual({ payload: FRITS });
  });

  it('adds nothing when they are already there, when no card is configured, or when the card is malformed', async () => {
    const known = rig({ known: ['frits-key'] });
    expect(await seedContactCard({ payload: FRITS, callSkill: known.callSkill })).toEqual({ seeded: false, reason: 'already-known', webid: 'frits-key' });
    expect(known.calls.map((c) => c.op)).toEqual(['listContacts']);
    const none = rig();
    expect(await seedContactCard({ payload: undefined, callSkill: none.callSkill })).toEqual({ seeded: false, reason: 'no-card' });
    expect(await seedContactCard({ payload: '   ', callSkill: none.callSkill })).toEqual({ seeded: false, reason: 'no-card' });
    expect(await seedContactCard({ payload: 'onderling-enroll://x', callSkill: none.callSkill })).toEqual({ seeded: false, reason: 'malformed-card' });
    expect(none.calls).toEqual([]);
  });

  it('a HIDDEN seeded contact stays hidden across launches — the seed sees them in the book and adds nothing (L106)', async () => {
    // Frits hides Wilfred; the next boot must not put Wilfred back. A hidden row is still a row in the book, so
    // "already known" covers it — asserted here so a future "skip hidden rows in listContacts" cannot quietly
    // reopen the seed. The seed reads the book through the roster's own fields.
    const calls = [];
    const callSkill = async (app, op, args) => {
      calls.push({ app, op, args });
      if (op === 'listContacts') return { items: [{ webid: 'frits-key', hidden: true }], contacts: [{ webid: 'frits-key', hidden: true, hiddenAt: 5 }] };
      if (op === 'addContactFromQr') throw new Error('must not re-add a hidden contact');
      return {};
    };
    expect(await seedContactCard({ payload: FRITS, callSkill })).toEqual({ seeded: false, reason: 'already-known', webid: 'frits-key' });
    expect(calls.map((c) => c.op)).toEqual(['listContacts']);
  });

  it('a refusal from the book is reported, not thrown', async () => {
    const r = rig();
    r.callSkill = async (app, op) => (op === 'listContacts' ? { items: [] } : { error: 'no-contacts' });
    expect(await seedContactCard({ payload: FRITS, callSkill: r.callSkill })).toEqual({ seeded: false, reason: 'no-contacts', webid: 'frits-key' });
  });
});

describe('through the real waist', () => {
  it('a real card seeds a PERSON in the book — never a bot — and a second boot adds nothing', async () => {
    const { bootRealAgentNode, teardown } = await import('../support/pairRealAgents.js');
    const { stoopContactToRow } = await import('../../src/v2/contactsSource.js');
    const [frits, fresh] = await Promise.all([bootRealAgentNode('frits'), bootRealAgentNode('fresh')]);
    try {
      const card = await frits.agent.callSkill('stoop', 'getContactShareQr', {});
      const callSkill = (app, op, args) => fresh.agent.callSkill(app, op, args);
      expect(await seedContactCard({ payload: card.payload, callSkill })).toEqual({ seeded: true, webid: frits.pubKey });
      const rows = (await callSkill('stoop', 'listContacts', {})).items;
      const row = rows.find((c) => c.webid === frits.pubKey);
      expect(row, 'the seeded person is in the book').toBeTruthy();
      expect(stoopContactToRow(row).isBot, 'a shipped contact is a person, not a bot').toBe(false);
      expect(await seedContactCard({ payload: card.payload, callSkill })).toEqual({ seeded: false, reason: 'already-known', webid: frits.pubKey });
      expect((await callSkill('stoop', 'listContacts', {})).items.filter((c) => c.webid === frits.pubKey)).toHaveLength(1);
    } finally { await teardown(frits, fresh); }
  }, 60_000);
});
