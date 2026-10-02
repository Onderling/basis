/**
 * A screen whose call waits for a yes in the person's chat does not wait for ever: within its own ten minutes it hears
 * the bot's outcome, or says "no answer" itself.
 */
import { describe, it, expect } from 'vitest';
import { createScreenView, screenAddressFor } from '../src/v2/screenView.js';
import { SCREEN_STEP_UP_SUBTYPE, SCREEN_STEP_UP_TTL_MS, SCREEN_STEP_UP_UNANSWERED } from '../src/v2/screenStepUp.js';

function connected() {
  const timers = [];
  let onPeer = null;
  const storage = new Map([['onderling.screen.BOT', JSON.stringify({ botAddress: 'BOT', relayUrl: 'wss://r', tokens: [{ skill: 'assistant.assistant-rotate' }] })]]);
  const view = createScreenView({
    link: `https://basis.example/app${screenAddressFor('BOT')}`,
    storage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    makeAgent: async () => ({
      agent: { pubKey: 'VIEW' },
      relay: { connect: async ({ onPeerMessage } = {}) => { onPeer = onPeerMessage; } },
      peer: { invoke: async () => [{ data: { ok: true, pending: true, message: 'asked' } }] },
    }),
    setTimer: (fn, ms) => { const h = { fn, ms, cleared: false }; timers.push(h); return h; },
    clearTimer: (h) => { if (h) h.cleared = true; },
  });
  return { view, timers, peer: (m) => onPeer?.(m) };
}

describe('the screen\'s own wait for a yes', () => {
  it('no word within ten minutes: the screen says "no answer" itself', async () => {
    const { view, timers } = connected();
    await view.resume();
    const notices = [];
    view.onNotice((n) => notices.push(n.outcome));
    await view.call('assistant.assistant-rotate', {});
    expect(timers).toHaveLength(1);
    expect(timers[0].ms).toBe(SCREEN_STEP_UP_TTL_MS);
    timers[0].fn();
    expect(notices).toEqual([SCREEN_STEP_UP_UNANSWERED]);
  });

  it('the bot\'s outcome first: that is said, and the wait ends', async () => {
    const { view, timers, peer } = connected();
    await view.resume();
    const notices = [];
    view.onNotice((n) => notices.push(n.outcome));
    await view.call('assistant.assistant-rotate', {});
    peer({ from: 'BOT', payload: { subtype: SCREEN_STEP_UP_SUBTYPE, outcome: 'done', op: 'assistant-rotate' } });
    expect(notices).toEqual(['done']);
    expect(timers[0].cleared).toBe(true);
  });
});
