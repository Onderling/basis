/**
 * The person-key chain lane: a contact PULLS my chain, never gets pushed a key. A request is answered for a contact
 * only; a reply lands only through the callee's verify from the version already known; nothing known → nothing taken.
 */
import { describe, it, expect } from 'vitest';
import { createPersonKeyChain, PERSON_KEY_CHAIN_SUBTYPES as S } from '../../src/v2/personKeyChain.js';

const chain = () => ({ current: { version: 3, pubKey: 'pk3' }, links: [{ version: 2, pubKey: 'pk2', prevVersion: 1, sig: 's' }, { version: 3, pubKey: 'pk3', prevVersion: 2, sig: 's' }] });
const mk = (over = {}) => {
  const sent = []; const adopted = []; const refused = [];
  const lane = createPersonKeyChain({
    chain, isContact: async (a) => a.startsWith('contact:'), known: async () => ({ version: 1, pubKey: 'pk1' }),
    adopt: async (webid, current, links) => { adopted.push({ webid, current, links }); return current; },
    sendToPeer: async (to, payload) => { sent.push({ to, payload }); }, onRefused: (r) => refused.push(r), ...over,
  });
  return { lane, sent, adopted, refused };
};

describe('the person-key chain lane', () => {
  it('answers a contact with the links since the version they hold', async () => {
    const { lane, sent } = mk();
    await lane.handlers[S.request]('contact:bea', { subtype: S.request, since: 2 });
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('contact:bea');
    expect(sent[0].payload.current).toEqual({ version: 3, pubKey: 'pk3' });
    expect(sent[0].payload.links.map((l) => l.version)).toEqual([3]);
  });
  it('refuses a stranger, both ways', async () => {
    const { lane, sent, adopted, refused } = mk();
    await lane.handlers[S.request]('stranger', { subtype: S.request, since: 0 });
    await lane.handlers[S.reply]('stranger', { subtype: S.reply, current: { version: 9, pubKey: 'x' }, links: [] });
    expect(sent).toHaveLength(0); expect(adopted).toHaveLength(0);
    expect(refused.map((r) => r.reason)).toEqual(['not-a-contact', 'not-a-contact']);
  });
  it('a reply is handed to the verifying adopt — and only when a base version is known', async () => {
    const { lane, adopted } = mk();
    await lane.handlers[S.reply]('contact:bea', { subtype: S.reply, current: { version: 3, pubKey: 'pk3' }, links: chain().links });
    expect(adopted).toHaveLength(1);
    expect(adopted[0].links).toHaveLength(2);
    const none = mk({ known: async () => null });
    await none.lane.handlers[S.reply]('contact:bea', { subtype: S.reply, current: { version: 3, pubKey: 'pk3' }, links: [] });
    expect(none.adopted).toHaveLength(0);
    expect(none.refused[0].reason).toBe('no-known-version');
  });
  it('asks once per burst', async () => {
    const { lane, sent } = mk();
    expect((await lane.requestFrom('contact:bea', 1)).asked).toBe(true);
    expect((await lane.requestFrom('contact:bea', 1)).asked).toBe(false);
    expect(sent).toHaveLength(1);
    expect(sent[0].payload).toEqual({ subtype: S.request, since: 1 });
  });
});
