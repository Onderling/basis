/**
 * THE KEYLESS ROW, THROUGH EVERY BASIS READER OF THE CONTACT BOOK.
 *
 * A household bot serves people over Telegram; each admitted person is a contact in the bot's one book — a row with a
 * door-shaped webid (`telegram:<uid>`), the door (`channel`), a role, and no key. The contact type declares that
 * shape (`KEYLESS_CONTACT_EXAMPLE`, `@onderling/item-types`); stoop's own test runs the book's methods over it. Here
 * every basis reader of the book runs over ONE such row in a real stoop contact book: the Contacten projection, the
 * share picker, the pair roster, the persona lens, delete, the persona backfill, the own-devices carry, the hop list.
 * Each works or refuses with a reason (`KEYLESS_REFUSAL`) — none throws, none invents a key or a pair circle for it.
 *
 * The box's and mobile's `isHidden` seam reads `(c.webid ?? c.pubKey) === contactId` inline in the shell; a keyless
 * row answers it by its webid, which is its id everywhere here.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighbourhoodAgent } from '@onderling-app/stoop';
import { KEYLESS_CONTACT_EXAMPLE, KEYLESS_REFUSAL, isKeylessContact } from '@onderling/item-types';
import {
  bookRowsOf, stoopContactToRow, loadBookRows, loadContactRoster, mergeContacts, splitShownHidden,
} from '../../src/v2/contactsSource.js';
import { pickableRecipients, recipientSealingKeyResolver } from '../../src/v2/shareRecipients.js';
import { createPairRoster, pairRouteFor } from '../../src/v2/pairRoster.js';
import { contactLensModel, changeContactLens } from '../../src/v2/contactLens.js';
import { deleteContact } from '../../src/v2/contactDelete.js';
import { backfillContactPersonas } from '../../src/v2/contactPersona.js';
import { knownPeersToWire } from '../../src/v2/knownPeersSync.js';
import { buildContactHopList } from '../../src/v2/contactHopOverrides.js';

const K = KEYLESS_CONTACT_EXAMPLE;
const admit = { webid: K.webid, displayName: K.displayName, channel: K.channel, role: K.role };

/**
 * A real stoop contact book behind the waist: stoop ops go to the stoop agent's own skills; every other call (the
 * persona registry, the circle machinery a reader may reach for) is recorded and answered empty, so a test can see
 * what a reader TRIED on the keyless row.
 */
async function hostWithKeylessRow(self = 'anna-webid') {
  const id = await AgentIdentity.generate(new VaultMemory());
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: new InternalTransport(new InternalBus(), id.pubKey),
    offeringMatch: { group: 'g', localActor: self, peers: [] },
    members: [{ webid: self }],
  });
  const calls = [];
  const callSkill = async (app, op, args = {}) => {
    calls.push({ app, op, args });
    const skill = app === 'stoop' ? bundle.agent.skills.get(op) : null;
    if (!skill || op === 'createGroupV2') return { ok: true };
    return skill.handler({ parts: [DataPart(args)], from: self, agent: bundle.agent, envelope: null });
  };
  const added = await callSkill('stoop', 'addContact', admit);
  if (added?.error) throw new Error(`the keyless row did not go in: ${added.error}`);
  const row = bookRowsOf(await callSkill('stoop', 'listContacts', {})).find((c) => c.webid === K.webid);
  calls.length = 0;
  return { self, bundle, callSkill, calls, row };
}

const tried = (calls, op) => calls.filter((c) => c.op === op);

let h;
beforeEach(async () => { h = await hostWithKeylessRow(); });

describe('the row as the book holds it', () => {
  it('is the declared shape: door, role, no key — one row for the person', async () => {
    expect(h.row).toMatchObject({ webid: K.webid, channel: 'telegram', role: 'member', relation: 'contact' });
    expect(isKeylessContact(h.row)).toBe(true);
    await h.callSkill('stoop', 'addContact', admit);   // admitted again
    expect(bookRowsOf(await h.callSkill('stoop', 'listContacts', {})).filter((c) => c.webid === K.webid)).toHaveLength(1);
  });
});

describe('the Contacten projection', () => {
  it('maps the row by its webid, with no address to write to — and never a key', async () => {
    const r = stoopContactToRow(h.row);
    expect(r).toMatchObject({ contactId: K.webid, name: K.displayName, peerAddr: null, isBot: false, source: 'contact' });
    expect(await loadBookRows(h.callSkill)).toEqual([r]);
    expect(mergeContacts([], [r])).toEqual([r]);
    expect(splitShownHidden([r])).toEqual({ shown: [r], hidden: [] });
  });

  it('the whole Contacten read composes over it', async () => {
    const rows = await loadContactRoster({ peerGraph: { all: async () => [] }, agent: null, callSkill: h.callSkill });
    expect(rows.map((x) => x.contactId)).toEqual([K.webid]);
    expect(rows[0].peerAddr).toBeNull();
  });
});

describe('the share picker', () => {
  it('leaves it out — there is no key to seal a share to — and resolves no sealing key for it', async () => {
    const r = stoopContactToRow(h.row);
    expect(pickableRecipients([r, h.row])).toEqual([]);
    const sealingKeyFor = recipientSealingKeyResolver({ contacts: () => [r], deriveSealingKey: () => 'derived' });
    expect(await sealingKeyFor(K.webid)).toBeNull();
  });
});

describe('the pair roster — founding needs a key', () => {
  it('the founding side refuses with a reason, and makes no circle', async () => {
    const pr = createPairRoster({ selfWebid: h.self, callSkill: h.callSkill, sendPeerRedeem: async () => ({}) });
    expect(await pr.prepare(K.webid, { name: K.displayName })).toEqual({ refused: KEYLESS_REFUSAL });
    expect(tried(h.calls, 'createGroupV2')).toEqual([]);
    expect(await pr.onRequest(K.webid)).toEqual({ refused: KEYLESS_REFUSAL });
    expect(tried(h.calls, 'createGroupV2')).toEqual([]);
  });

  it('the other side asks for nothing', async () => {
    const z = await hostWithKeylessRow('zed-webid');   // sorts after `telegram:` — the side that would ask
    const pr = createPairRoster({ selfWebid: z.self, callSkill: z.callSkill, sendPeerRedeem: async () => ({}) });
    expect(await pr.prepare(K.webid)).toEqual({ refused: KEYLESS_REFUSAL });
  });

  it('a door id the book does not hold yet is refused the same way', async () => {
    const pr = createPairRoster({ selfWebid: h.self, callSkill: h.callSkill, sendPeerRedeem: async () => ({}) });
    expect(await pr.prepare('telegram:999')).toEqual({ refused: KEYLESS_REFUSAL });
    expect(tried(h.calls, 'createGroupV2')).toEqual([]);
  });

  it('there is no route to it: no pair circle is here', async () => {
    expect(await pairRouteFor({ callSkill: h.callSkill, selfWebid: h.self, contactWebid: K.webid })).toBeNull();
  });
});

describe('the persona lens', () => {
  it('the model reads over it without reaching for a pair circle it cannot have', async () => {
    const m = await contactLensModel({ callSkill: h.callSkill, row: h.row });
    expect(m).toMatchObject({ webid: K.webid, persona: 'default' });
    expect(tried(h.calls, 'getPersonaView'), 'read a disclosure for a phantom pair circle').toEqual([]);
  });

  it('a change is refused with a reason, and writes nothing', async () => {
    const r = await changeContactLens({ callSkill: h.callSkill, contactId: K.webid, persona: 'buurt', revealPreset: 'full', shareRelease: async () => {} });
    expect(r).toMatchObject({ error: KEYLESS_REFUSAL, releaseShared: false });
    expect(tried(h.calls, 'setContactPersona')).toEqual([]);
    expect(tried(h.calls, 'setProfileDisclosure')).toEqual([]);
  });
});

describe('hide and delete', () => {
  it('deleting hides the row and leaves no circle (there is none); the row stays keyless', async () => {
    expect(await deleteContact({ callSkill: h.callSkill, agent: null, contactWebid: K.webid, pairCircleId: null })).toEqual({ ok: true, left: false });
    const row = bookRowsOf(await h.callSkill('stoop', 'listContacts', {})).find((c) => c.webid === K.webid);
    expect(row).toMatchObject({ hidden: true, channel: 'telegram' });
    expect(isKeylessContact(row)).toBe(true);
    expect(splitShownHidden([stoopContactToRow(row)]).hidden).toHaveLength(1);
  });
});

describe('the persona backfill', () => {
  it('skips it — no pair circle, no fact to write from', async () => {
    const written = [];
    const setPersona = async (...a) => { written.push(a); };
    for (const rows of [[h.row], [stoopContactToRow(h.row)]]) {
      const r = await backfillContactPersonas({ rows, selfWebid: h.self, setPersona });
      expect(r).toMatchObject({ written: 0, mismatched: 0 });
    }
    expect(written).toEqual([]);
  });
});

describe('the own-devices carry', () => {
  it('carries the row whole — its door and its role — and still no key', async () => {
    const wire = knownPeersToWire({ contacts: [h.row] });
    expect(wire.contacts).toHaveLength(1);
    expect(wire.contacts[0]).toMatchObject({ webid: K.webid, channel: 'telegram', role: 'member', displayName: K.displayName });
    expect(wire.contacts[0].pubKey).toBeUndefined();
    // …and the sibling's book takes it as the same row
    const sib = await hostWithKeylessRow('sib-webid');
    const landed = await sib.callSkill('stoop', 'addContact', { ...wire.contacts[0], webid: 'telegram:5' });
    expect(landed.contact).toMatchObject({ channel: 'telegram', role: 'member' });
    expect(isKeylessContact(landed.contact)).toBe(true);
  });
});

describe('the hop list', () => {
  it('lists it by name', () => {
    expect(buildContactHopList({ contacts: [h.row] })).toMatchObject([{ id: K.webid, label: K.displayName, mode: 'off' }]);
  });
});
