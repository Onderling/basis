/**
 * addBotToGraph — the ONE input decoder behind both shells' contact-add box (C13: one handshake,
 * two rungs, and the URI names the rung).
 *
 * The load-bearing pair: a `onderling-contact://` card takes the FAST rung (asymmetric add via stoop's
 * `addContactFromQr` — the card's decoding stays there, the one decoder), while a `onderling-invite://`
 * pasted in the same box is REFUSED with a typed error — silently upserting a "contact" out of a
 * circle invite would skip the verified rung's consent gate.
 */
import { describe, it, expect, vi } from 'vitest';
import { addBotToGraph, CONTACT_CARD_PREFIX, CIRCLE_INVITE_PREFIX } from '../../src/v2/addBot.js';

const graph = () => ({ upsert: vi.fn(async (rec) => rec) });

describe('addBotToGraph — the C13 fast rung', () => {
  it('routes a onderling-contact:// card to the injected addContact and returns the contact', async () => {
    const addContact = vi.fn(async () => ({ contact: { webid: 'did:bram', displayName: 'Bram', peerAddr: 'addr:bram' } }));
    const payload = `${CONTACT_CARD_PREFIX}abc123`;
    const rec = await addBotToGraph({ input: payload, peerGraph: graph(), addContact });
    expect(addContact).toHaveBeenCalledWith(payload);   // the payload passes through UNDECODED — stoop decodes
    expect(rec.displayName).toBe('Bram');
    expect(rec.peerAddr).toBe('addr:bram');             // deliver-ready: the DM address rides the card
  });

  it('a contact card with no addContact wired fails loud, not as a garbage peer upsert', async () => {
    const g = graph();
    await expect(addBotToGraph({ input: `${CONTACT_CARD_PREFIX}abc`, peerGraph: g }))
      .rejects.toThrow(/addContact/);
    expect(g.upsert).not.toHaveBeenCalled();            // the pre-C13 bug: this became a hybrid "bot" row
  });

  it('surfaces a stoop error result as a thrown, coded error', async () => {
    const addContact = vi.fn(async () => ({ error: 'malformed-card' }));
    await expect(addBotToGraph({ input: `${CONTACT_CARD_PREFIX}zzz`, peerGraph: graph(), addContact }))
      .rejects.toMatchObject({ code: 'malformed-card' });
  });

  it('a onderling-invite:// is the VERIFIED rung — refused with code circle-invite, nothing added', async () => {
    const g = graph();
    const addContact = vi.fn();
    await expect(addBotToGraph({ input: `${CIRCLE_INVITE_PREFIX}xyz`, peerGraph: g, addContact }))
      .rejects.toMatchObject({ code: 'circle-invite' });
    expect(addContact).not.toHaveBeenCalled();
    expect(g.upsert).not.toHaveBeenCalled();
  });
});

describe('addBotToGraph — the existing inputs, unchanged', () => {
  it('an https URL goes through discover (discoverA2A)', async () => {
    const discover = vi.fn(async () => ({ type: 'a2a', url: 'https://bot.example' }));
    const g = graph();
    const rec = await addBotToGraph({ input: 'https://bot.example', peerGraph: g, coreAgent: {}, discover });
    expect(discover).toHaveBeenCalled();
    expect(rec.url).toBe('https://bot.example');
  });

  it('a raw address (addr|Name) upserts a hybrid peer', async () => {
    const g = graph();
    const rec = await addBotToGraph({ input: 'addr123|Robo', peerGraph: g });
    expect(g.upsert).toHaveBeenCalled();
    expect(rec).toMatchObject({ type: 'hybrid', pubKey: 'addr123', name: 'Robo' });
  });
});
