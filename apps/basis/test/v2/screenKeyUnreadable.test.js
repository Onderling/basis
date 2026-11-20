/**
 * A screen's own key that is there but will not read is never replaced on its own (L1115): the screen client says
 * `key-unreadable` (also through a wrapping error), and the Basis screen forgets exactly its own entries on request.
 */
import { describe, it, expect } from 'vitest';
import { screenClientCode, SCREEN_CLIENT_CODES } from '../../src/v2/screenClient.js';
import { forgetScreenKey } from '../../src/web/screenAgent.js';

describe('a screen whose own key will not read (L1115)', () => {
  it('the client code is key-unreadable, through a wrap too', () => {
    expect(SCREEN_CLIENT_CODES).toContain('key-unreadable');
    expect(screenClientCode({ code: 'key-unreadable' })).toBe('key-unreadable');
    expect(screenClientCode(Object.assign(new Error('wrapped'), { cause: { code: 'key-unreadable' } }))).toBe('key-unreadable');
    expect(screenClientCode(new Error('boom'))).toBe('failed');
  });
  it('forgetting removes only this screen\'s key and grants', () => {
    const m = new Map([['onderling-screen:agent-privkey', 'x'], ['onderling.screen.BOT', 'g'], ['cc.circlePinned', 'p']]);
    const storage = { get length() { return m.size; }, key: (i) => [...m.keys()][i] ?? null, removeItem: (k) => { m.delete(k); } };
    expect(forgetScreenKey(storage)).toBe(2);
    expect([...m.keys()]).toEqual(['cc.circlePinned']);
  });
});
