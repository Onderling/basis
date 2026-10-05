/**
 * A screen that RESUMED a kept grant also takes a new grant for its own key from its own bot (L196): the bot supersedes
 * a key's earlier grant whenever that key is paired again (another tab, the webview opened anew), and a resumed page
 * that ignored the new grant kept calling with superseded tokens — "Token has been revoked". From the bot's address
 * only, and only tokens for this page's own key; the bot's door still checks every token.
 */
import { describe, it, expect } from 'vitest';
import { createScreenView, screenAddressFor } from '../src/v2/screenView.js';
import { CONNECTION_GRANT_SUBTYPE } from '../src/v2/connectionPairing.js';

const BOT = 'BOTKEY';
const ME = 'SCREENKEY';

function fakeAgent() {
  const sa = { agent: { pubKey: ME }, used: [], onPeer: null };
  sa.relay = { connect: async ({ onPeerMessage }) => { sa.onPeer = onPeerMessage; } };
  sa.peer = { sendTo: async () => {}, invoke: async (_to, skill, _parts, { token }) => { sa.used.push([skill, token.id]); return [{ data: { ok: true } }]; } };
  return sa;
}

describe('a resumed screen takes its bot\'s new grant', () => {
  it('the new tokens replace the kept ones, and are kept for the next visit', async () => {
    const storage = new Map([[`onderling.screen.${BOT}`, JSON.stringify({ botAddress: BOT, relayUrl: null, tokens: [{ id: 'old', skill: 'lists.listLists', subject: ME }] })]]);
    const store = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) };
    const sa = fakeAgent();
    const view = createScreenView({ link: `https://x/${screenAddressFor(BOT)}`, makeAgent: async () => sa, storage: store });
    expect(await view.resume()).toBe(true);
    await view.call('lists.listLists');
    sa.onPeer({ from: BOT, payload: { subtype: CONNECTION_GRANT_SUBTYPE, nonce: 'n2', tokens: [{ id: 'new', skill: 'lists.listLists', subject: ME, issuer: BOT }] } });
    await view.call('lists.listLists');
    expect(sa.used.map((u) => u[1])).toEqual(['old', 'new']);
    expect(JSON.parse(storage.get(`onderling.screen.${BOT}`)).tokens[0].id).toBe('new');
  });

  it('not from its bot, or not for its own key: ignored', async () => {
    const storage = new Map([[`onderling.screen.${BOT}`, JSON.stringify({ botAddress: BOT, tokens: [{ id: 'old', skill: 'lists.listLists', subject: ME }] })]]);
    const sa = fakeAgent();
    const view = createScreenView({ link: `https://x/${screenAddressFor(BOT)}`, makeAgent: async () => sa, storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) } });
    await view.resume();
    sa.onPeer({ from: 'SOMEONE', payload: { subtype: CONNECTION_GRANT_SUBTYPE, nonce: 'x', tokens: [{ id: 'evil', skill: 'lists.listLists', subject: ME }] } });
    sa.onPeer({ from: BOT, payload: { subtype: CONNECTION_GRANT_SUBTYPE, nonce: 'x', tokens: [{ id: 'other', skill: 'lists.listLists', subject: 'ANOTHER' }] } });
    await view.call('lists.listLists');
    expect(sa.used.map((u) => u[1])).toEqual(['old']);
  });
});
