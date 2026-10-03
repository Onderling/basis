/**
 * A household change reaches a connected screen as a NUDGE that names nothing: the bot sends each of its screens
 * `{subtype: 'screen-nudge'}` — no item, no list, no person — a moment after the last write (a burst of writes is one
 * nudge), and the screen reads again through its own calls. A nudge from any other key is not its bot's.
 */
import { describe, it, expect } from 'vitest';
import { createScreenNudge, SCREEN_NUDGE_SUBTYPE } from '../src/v2/screenNudge.js';
import { createScreenView, screenAddressFor } from '../src/v2/screenView.js';

describe('the bot nudges its screens', () => {
  it('a burst of writes is one nudge to each screen, and the nudge names nothing', async () => {
    const sent = [];
    let fire = null;
    const nudge = createScreenNudge({
      listScreens: async () => [{ viewPubKey: 'V1' }, { viewPubKey: 'V2' }],
      send: async (to, payload) => { sent.push([to, payload]); },
      setTimer: (fn) => { fire = fn; return 1; }, clearTimer: () => {},
    });
    nudge.touched('household'); nudge.touched('household'); nudge.touched('household');
    expect(sent).toEqual([]);
    await fire();
    expect(sent).toEqual([['V1', { subtype: SCREEN_NUDGE_SUBTYPE }], ['V2', { subtype: SCREEN_NUDGE_SUBTYPE }]]);
  });

  it('no screens: nothing sent', async () => {
    const sent = [];
    let fire = null;
    const nudge = createScreenNudge({ listScreens: async () => [], send: async (...a) => sent.push(a), setTimer: (fn) => { fire = fn; return 1; }, clearTimer: () => {} });
    nudge.touched('household');
    await fire();
    expect(sent).toEqual([]);
  });
});

describe('the screen hears its bot\'s nudge', () => {
  it('from its bot: the listener is told; from another key: not', async () => {
    let onPeer = null;
    const storage = new Map([['onderling.screen.BOT', JSON.stringify({ botAddress: 'BOT', relayUrl: 'wss://r', tokens: [] })]]);
    const view = createScreenView({
      link: `https://basis.example/app${screenAddressFor('BOT')}`,
      storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
      makeAgent: async () => ({ agent: { pubKey: 'V' }, relay: { connect: async ({ onPeerMessage } = {}) => { onPeer = onPeerMessage; } }, peer: {} }),
    });
    await view.resume();
    let heard = 0;
    view.onNudge(() => { heard += 1; });
    onPeer({ from: 'SOMEONE', payload: { subtype: SCREEN_NUDGE_SUBTYPE } });
    expect(heard).toBe(0);
    onPeer({ from: 'BOT', payload: { subtype: SCREEN_NUDGE_SUBTYPE } });
    expect(heard).toBe(1);
  });
});
