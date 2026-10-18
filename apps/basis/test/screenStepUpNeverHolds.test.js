/**
 * Telling a screen how its held request ended (replaced, declined, expired, done) never holds the person's reply: a
 * send to a screen that does not greet back runs the 23 s handshake ladder. The screen is still told, after.
 */
import { describe, it, expect } from 'vitest';
import { createScreenStepUp } from '../src/v2/screenStepUp.js';

describe('the step-up tells the screen, never waiting on it', () => {
  it('replace and decline answer at once; the screen hears both after', async () => {
    let release;
    const held = new Promise((r) => { release = r; });
    const told = [];
    let n = 0;
    const stepUp = createScreenStepUp({
      ask: async () => ({ ok: true }),
      tell: async (viewPubKey, o) => { await held; told.push([viewPubKey, o.outcome]); },
      makeId: () => `ID${++n}`,
      setTimer: () => null,
    });
    const quick = (p) => Promise.race([p, new Promise((_, no) => { setTimeout(() => no(new Error('the reply waited for the screen')), 500); })]);
    await stepUp.hold('p', { op: 'assistant-role', args: {}, viewPubKey: 'S1' }, 'q');
    const second = await quick(stepUp.hold('p', { op: 'assistant-role', args: {}, viewPubKey: 'S2' }, 'q'));
    expect(second.ok).toBe(true);
    expect(await quick(stepUp.answer('p', false, second.id, { isPrivate: true }))).toMatchObject({ ok: true, declined: true });
    expect(told).toEqual([]);
    release();
    await new Promise((r) => { setTimeout(r, 0); });
    expect(told).toEqual([['S1', 'replaced'], ['S2', 'declined']]);
  });
});
