/**
 * The screen takes a grant only from the bot it offered to, and never waits for ever: a grant-shaped message from any
 * other key is ignored; the bot's "not taken" ends the wait as `refused`; nothing within the time ends it as `timed-out`.
 */
import { describe, it, expect } from 'vitest';
import { createScreenView, SCREEN_REFUSED_SUBTYPE } from '../../src/v2/screenView.js';
import { encodeScreenLink } from '../../src/v2/botScreens.js';
import { CONNECTION_GRANT_SUBTYPE } from '../../src/v2/connectionPairing.js';

const link = encodeScreenLink('https://basis.example/app', { botAddress: 'BOT', relayUrl: 'wss://r', nonce: 'n1' });
function fakeAgent() {
  const a = { hear: null, sent: [], agent: { pubKey: 'VIEW' } };
  a.relay = { connect: async ({ onPeerMessage } = {}) => { a.hear = onPeerMessage; } };
  a.peer = { sendTo: async (to, payload) => { a.sent.push({ to, payload }); }, invoke: async () => [] };
  return a;
}
const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };
const grant = { subtype: CONNECTION_GRANT_SUBTYPE, nonce: 'n1', tokens: [{ subject: 'VIEW', skill: 'lists.addToList', issuer: 'BOT' }] };

describe('the screen and the bot it offered to', () => {
  it('a grant from another key is ignored; from the bot it is taken', async () => {
    const sa = fakeAgent();
    const view = createScreenView({ link, makeAgent: async () => sa, storage: store() });
    await view.connect();
    expect(sa.sent[0]).toMatchObject({ to: 'BOT', payload: { subtype: 'screen-offer' } });
    sa.hear({ from: 'MALLORY', payload: grant });
    sa.hear({ from: 'MALLORY', payload: { subtype: SCREEN_REFUSED_SUBTYPE } });
    expect(view.ops(), 'not from the bot: not taken').toEqual([]);
    sa.hear({ from: 'BOT', payload: grant });
    expect(view.ops()).toEqual(['lists.addToList']);
    await expect(view.granted({ timeoutMs: 1_000 }), 'a stranger\'s "refused" did not end the wait').resolves.toBeTruthy();
  });

  it('the bot says "not taken": the wait ends as refused', async () => {
    const sa = fakeAgent();
    const view = createScreenView({ link, makeAgent: async () => sa, storage: store() });
    await view.connect();
    const waiting = view.granted({ timeoutMs: 5_000 });
    sa.hear({ from: 'BOT', payload: { subtype: SCREEN_REFUSED_SUBTYPE } });
    await expect(waiting).rejects.toThrow('refused');
  });

  it('nothing within the time: the wait ends as timed-out', async () => {
    const view = createScreenView({ link, makeAgent: async () => fakeAgent(), storage: store() });
    await view.connect();
    await expect(view.granted({ timeoutMs: 30 })).rejects.toThrow('timed-out');
  });
});
