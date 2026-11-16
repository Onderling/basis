/**
 * A TURN HELD AFTER A REFUSAL SAYS SO (Fable 2026-11-14, after the door stopped dropping turns): the contact door holds a
 * turn it could not keep whole (its text cut to the bound, its file left off), marked `refused`. The person must not take
 * it for the whole message. One shared note says it, the same in the request and, after Accept, on that turn in the
 * thread, on every device of the person.
 */
import { describe, it, expect, vi } from 'vitest';
import { heldNoteOf, heldNoteKey, messageRequestRows, acceptMessageRequest } from '../../src/v2/messageRequestAccept.js';
import { createContactThreadChannel } from '../../src/v2/contactThreadChannel.js';
import { contactTurnToWire } from '../../src/v2/contactTurnFan.js';

function memItemStore() {
  const items = [];
  return {
    items,
    addItems: vi.fn(async (drafts) => {
      const persisted = drafts.map((d, i) => ({ id: `id-${items.length + i}`, addedAt: Date.now(), ...d }));
      items.push(...persisted);
      return persisted;
    }),
    listOpen: vi.fn(async () => items.slice()),
  };
}
const channel = () => createContactThreadChannel({ sendToPeer: vi.fn(async () => ({})), itemStore: memItemStore() });

describe('a held turn says what was not kept', () => {
  it('the refusal codes map to what the person needs to know; the rest says nothing', () => {
    expect(heldNoteOf('turn-too-large')).toBe('cut');
    expect(heldNoteOf('file-on-request')).toBe('file');
    for (const r of ['no-card', 'malformed-card', 'card-not-sender', 'hold-threw', null, undefined, 'made-up']) expect(heldNoteOf(r), String(r)).toBeNull();
    expect(heldNoteKey('cut')).toBe('circle.contacts.held.cut');
    expect(heldNoteKey('file')).toBe('circle.contacts.held.file');
    expect(heldNoteKey('anything-else')).toBeNull();
  });

  it('the request row carries the notes of its held turns, once each', () => {
    const [row] = messageRequestRows([{ from: 'k', name: 'Ann', state: 'open', turns: [
      { messageId: 'a', text: 'x', ts: 1, refused: 'turn-too-large' },
      { messageId: 'b', text: 'y', ts: 2, refused: 'turn-too-large' },
      { messageId: 'c', text: '', ts: 3, refused: 'file-on-request' },
      { messageId: 'd', text: 'z', ts: 4, refused: 'malformed-card' },
      { messageId: 'e', text: 'w', ts: 5 },
    ] }]);
    expect(row.notes).toEqual(['circle.contacts.held.cut', 'circle.contacts.held.file']);
    const [plain] = messageRequestRows([{ from: 'k', name: 'Ann', state: 'open', turns: [{ messageId: 'a', text: 'x', ts: 1 }] }]);
    expect(plain.notes).toEqual([]);
  });

  it('accepted, the held turns go onto the thread with their note', async () => {
    const persisted = [];
    const callSkill = async () => ({ contact: null, turns: [
      { messageId: 'a', text: 'cut sh', ts: 1, refused: 'turn-too-large' },
      { messageId: 'b', text: 'whole', ts: 2 },
    ] });
    const r = await acceptMessageRequest({ callSkill, channel: { persistInbound: async (t) => { persisted.push(t); } }, from: 'k' });
    expect(r).toMatchObject({ accepted: true, turns: 2 });
    expect(persisted[0]).toMatchObject({ messageId: 'a', held: 'cut' });
    expect(persisted[1].held).toBeUndefined();
  });

  it('the thread stores the note on the turn and reads it back; an unknown value is not stored', async () => {
    const ch = channel();
    await ch.persistInbound({ contactId: 'k', fromAddr: 'k', text: 'cut sh', messageId: 'm1', ts: 1, held: 'cut' });
    await ch.persistInbound({ contactId: 'k', fromAddr: 'k', text: '', messageId: 'm2', ts: 2, held: 'file' });
    await ch.persistInbound({ contactId: 'k', fromAddr: 'k', text: 'odd', messageId: 'm3', ts: 3, held: 'nonsense' });
    const turns = await ch.rehydrate('k');
    const by = Object.fromEntries(turns.map((t) => [t.messageId, t]));
    expect(by.m1.held).toBe('cut');
    expect(by.m2.held, 'a file left off with no text is still a turn: its note is all there is').toBe('file');
    expect(by.m3.held).toBeUndefined();
  });

  it('the note travels to the person\'s other devices, an empty held turn included', async () => {
    const wire = contactTurnToWire({ direction: 'in', contactId: 'k', fromAddr: 'k', text: '', messageId: 'm2', ts: 2, held: 'file' });
    expect(wire).toMatchObject({ held: 'file', messageId: 'm2' });
    expect(contactTurnToWire({ direction: 'in', contactId: 'k', text: '', held: 'nonsense' }), 'nothing to show').toBeNull();
    const sibling = channel();
    const landed = await sibling.applyOwnDeviceTurn(wire);
    expect(landed.held).toBe('file');
    expect((await sibling.rehydrate('k')).find((t) => t.messageId === 'm2')?.held).toBe('file');
  });
});
