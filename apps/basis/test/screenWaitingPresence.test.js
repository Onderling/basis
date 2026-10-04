/**
 * A screen waiting for its grant says now and then that it is there. The bot sends the grant "hold-forward": when the
 * screen cannot answer at that moment (a phone that put the browser away while the person was in Telegram), the grant
 * is HELD until the screen next speaks — and a screen on the paste route never spoke, so the grant waited for ever
 * (Frits, 2026-10-04: "Gekoppeld." in the chat, the page waiting; a restart of the box emptied the hold). So while it
 * waits, the screen greets the bot (any message from it releases what is held), every so often and when it is shown
 * again; once the grant is in, it stops.
 */
import { describe, it, expect } from 'vitest';
import { createScreenView, SCREEN_WAITING_SUBTYPE, SCREEN_WAITING_EVERY_MS } from '../src/v2/screenView.js';
import { encodeScreenStartLink } from '../src/v2/botScreens.js';
import { parsePairingOffer, CONNECTION_GRANT_SUBTYPE } from '../src/v2/connectionPairing.js';

function waitingScreen() {
  const timers = []; const sent = [];
  let onPeer = null;
  const store = new Map();
  const view = createScreenView({
    link: encodeScreenStartLink('https://basis.example/app', { botAddress: 'BOT', relayUrl: 'wss://r' }),
    storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    makeAgent: async () => ({
      agent: { pubKey: 'VIEW' },
      relay: { connect: async ({ onPeerMessage } = {}) => { onPeer = onPeerMessage; } },
      peer: { sendTo: async (to, payload) => { sent.push({ to, payload }); return { delivered: true }; } },
    }),
    setTimer: (fn, ms) => { const h = { fn, ms, cleared: false }; timers.push(h); return h; },
    clearTimer: (h) => { if (h) h.cleared = true; },
  });
  return { view, timers, sent, peer: (m) => onPeer?.(m) };
}
const live = (timers) => timers.filter((h) => !h.cleared && !h.fired && h.ms === SCREEN_WAITING_EVERY_MS);
const fire = (h) => { h.fired = true; h.fn(); };
const greetings = (sent) => sent.filter((s) => s.to === 'BOT' && s.payload?.subtype === SCREEN_WAITING_SUBTYPE);

describe('a screen waiting for its grant says it is there', () => {
  it('on the paste route: every so often, and when shown again; nothing once the grant is in', async () => {
    const d = waitingScreen();
    const { offer } = await d.view.connect({ label: 'browser' });
    expect(offer).toBeTruthy();
    expect(live(d.timers)).toHaveLength(1);
    fire(live(d.timers)[0]);
    await Promise.resolve();
    expect(greetings(d.sent)).toHaveLength(1);
    expect(live(d.timers)).toHaveLength(1);           // and again later
    await d.view.stillHere();                          // shown again (the page came back to the front)
    expect(greetings(d.sent)).toHaveLength(2);

    const { nonce } = parsePairingOffer(offer);
    d.peer({ from: 'BOT', payload: { subtype: CONNECTION_GRANT_SUBTYPE, nonce, tokens: [{ subject: 'VIEW', skill: 'lists.listLists' }] } });
    expect((await d.view.granted()).botAddress).toBe('BOT');
    expect(live(d.timers)).toHaveLength(0);
    await d.view.stillHere();
    expect(greetings(d.sent)).toHaveLength(2);         // granted: it no longer greets
  });
});
