/**
 * A PERSON'S MESSAGE CARRIED FROM A SIBLING IS STILL A MESSAGE.
 *
 * The profile address maps to one socket, and which one can race (a device stepping down, a box whose primary
 * registration is still being proven). When a person's message lands on the phone instead of the box, the phone
 * carries it to the box — and until now the carry said only "a turn came in": not that it was a person's MESSAGE
 * (a bot's REPLY must never be answered: two bots would answer each other), and without the admission code or the
 * linked person's proof the box's door decides on. The box stored it and its assistant never heard of it.
 *
 * The claims: the channel marks a turn that arrived as a message and carries its admission and proof on the fan; a
 * reply is carried unmarked; and on the receiving device a carried message is landed like a direct one — logged,
 * and handed to the door — only where this device is the person's primary, so two boxes never both answer.
 */
import { describe, it, expect, vi } from 'vitest';
import { createContactThreadChannel } from '../src/v2/contactThreadChannel.js';
import { contactTurnToWire, makeCarriedTurnLanding } from '../src/v2/contactTurnFan.js';

const rig = () => {
  const fanned = [];
  const ch = createContactThreadChannel({ sendToPeer: vi.fn(async () => ({})), fanToOwnDevices: async (t) => { fanned.push(t); } });
  return { ch, fanned };
};
// a shell lands what the handler hands it the way the shells do: the picked fields into persistInbound
const landAsShell = (ch) => (m) => ch.persistInbound({ contactId: m.contactId, fromAddr: m.fromAddr, text: m.text, buttons: m.buttons, messageId: m.messageId, replyTo: m.replyTo, ts: 1 });

describe('the carry says what the turn was', () => {
  it('a turn that arrived as a person\'s MESSAGE is fanned marked as one, with its admission and proof', async () => {
    const { ch, fanned } = rig();
    const done = [];
    const h = ch.messageHandler((m) => { done.push(landAsShell(ch)(m)); });
    await h('anna-addr', { subtype: ch.subtypes.out, text: 'hoi', messageId: 'm1', admission: 'CODE-1', auth: { sig: 'x' } });
    await Promise.all(done);
    expect(fanned).toHaveLength(1);
    expect(fanned[0]).toMatchObject({ direction: 'in', text: 'hoi', message: true, admission: 'CODE-1', auth: { sig: 'x' } });
    expect(contactTurnToWire(fanned[0])).toMatchObject({ message: true, admission: 'CODE-1', auth: { sig: 'x' } });
  });
  it('a bot\'s REPLY is carried unmarked — never something to answer', async () => {
    const { ch, fanned } = rig();
    const done = [];
    const h = ch.replyHandler((m) => { done.push(landAsShell(ch)(m)); });
    await h('bot-addr', { subtype: ch.subtypes.in, text: 'dag', messageId: 'r1' });
    await Promise.all(done);
    expect(fanned).toHaveLength(1);
    expect(fanned[0].message).toBeUndefined();
    expect(contactTurnToWire(fanned[0]).message).toBeUndefined();
  });
  it('the wire keeps only well-formed markers', () => {
    expect(contactTurnToWire({ contactId: 'a', text: 't', message: 'yes', admission: 7, auth: 'no' })).toEqual({ direction: 'in', contactId: 'a', text: 't' });
  });
});

describe('a carried message on the receiving device', () => {
  const landing = ({ primary, deduped = false }) => {
    const log = []; const fed = [];
    const land = makeCarriedTurnLanding({
      apply: async (wire) => ({ contactId: wire.contactId, deduped }),
      isPrimary: () => primary,
      feed: (t) => { fed.push(t); },
      log: (e) => { log.push(e); },
    });
    return { land, log, fed };
  };
  const msg = { direction: 'in', contactId: 'anna', fromAddr: 'anna-addr', text: 'hoi', messageId: 'm1', message: true, admission: 'CODE-1', auth: { sig: 'x' } };

  it('on the primary: logged as a contact turn and handed to the door, admission and proof included', async () => {
    const { land, log, fed } = landing({ primary: true });
    await land(msg);
    expect(log).toEqual([{ kind: 'contact-turn', from: 'anna-addr'.slice(0, 12), text: 'hoi', carried: true }]);
    expect(fed).toEqual([{ contactId: 'anna', fromAddr: 'anna-addr', text: 'hoi', messageId: 'm1', admission: 'CODE-1', auth: { sig: 'x' } }]);
  });
  it('not the primary: stored and logged, never answered here', async () => {
    const { land, log, fed } = landing({ primary: false });
    await land(msg);
    expect(log).toHaveLength(1);
    expect(fed).toEqual([]);
  });
  it('a reply, an outbound turn, or a duplicate is never handed to the door', async () => {
    const a = landing({ primary: true }); await a.land({ ...msg, message: undefined }); expect(a.fed).toEqual([]);
    const b = landing({ primary: true }); await b.land({ ...msg, direction: 'out' }); expect(b.fed).toEqual([]); expect(b.log).toEqual([]);
    const c = landing({ primary: true, deduped: true }); await c.land(msg); expect(c.fed).toEqual([]); expect(c.log).toEqual([]);
  });
});
