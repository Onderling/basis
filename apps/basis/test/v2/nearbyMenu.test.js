import { describe, it, expect, vi } from 'vitest';
import { nearbyHereNow, nearbyHereWrites, nearbyHereChoose, nearbyMenu, NEARBY_HERE } from '../../src/v2/nearbyMenu.js';

describe('the gear menu: how you are here', () => {
  it('reads the choice that holds now from the controller\'s report; no level chosen yet holds none', () => {
    expect(nearbyHereNow({ radioOff: true, quiet: true, levelChosen: true })).toBe('off');
    expect(nearbyHereNow({ quiet: true, levelChosen: true })).toBe('quiet');
    expect(nearbyHereNow({ publishing: true, levelChosen: true })).toBe('visible');
    expect(nearbyHereNow({ pending: true, levelChosen: true })).toBe('visible');
    expect(nearbyHereNow({ levelChosen: false }), '"Alleen kijken": asked, nothing chosen').toBe(null);
    expect(nearbyHereNow(null)).toBe(null);
  });

  it('Zichtbaar from level none writes the floor (handle); a level above none is kept, never overwritten', () => {
    expect(nearbyHereWrites('visible', { level: 'none', visibility: {} })).toEqual({ level: 'handle', quiet: false, radio: null });
    expect(nearbyHereWrites('visible', { level: null, visibility: {} }).level).toBe('handle');
    expect(nearbyHereWrites('visible', { level: 'profile', visibility: {} }).level).toBe(null);
    expect(nearbyHereWrites('visible', { level: 'full', visibility: { radioOff: true } })).toEqual({ level: null, quiet: false, radio: 'on' });
  });

  it('Even stil and Helemaal uit write no level; Even stil turns a switched-off radio back on (it still sees the room)', () => {
    expect(nearbyHereWrites('quiet', { level: 'none', visibility: {} })).toEqual({ level: null, quiet: true, radio: null });
    expect(nearbyHereWrites('quiet', { level: 'handle', visibility: { radioOff: true } })).toEqual({ level: null, quiet: true, radio: 'on' });
    expect(nearbyHereWrites('off', { level: 'none', visibility: {} })).toEqual({ level: null, quiet: null, radio: 'off' });
    expect(nearbyHereWrites('nonsense', { level: 'none' })).toBe(null);
  });

  it('a choice runs through the host\'s own acts, the level first (so going visible announces at the right level)', async () => {
    const order = [];
    const acts = {
      setLevel: vi.fn(async (l) => { order.push(`level:${l}`); return { ok: true }; }),
      setQuiet: vi.fn((q) => order.push(`quiet:${q}`)),
      setRadio: vi.fn((r) => order.push(`radio:${r}`)),
    };
    const r = await nearbyHereChoose('visible', { level: 'none', visibility: { radioOff: true } }, acts);
    expect(r.ok).toBe(true);
    expect(order).toEqual(['level:handle', 'radio:on', 'quiet:false']);
    // a level that could not be written stops the choice: nothing announced at a level that is not there
    const failing = { ...acts, setLevel: vi.fn(async () => ({ ok: false })) };
    order.length = 0;
    expect((await nearbyHereChoose('visible', { level: 'none', visibility: {} }, failing)).ok).toBe(false);
    expect(order).toEqual([]);
  });

  it('the menu offers only the choices this host can carry (the web has no radio and no quiet switch)', () => {
    const m = nearbyMenu({ visibility: { publishing: true, levelChosen: true }, can: { quiet: false, radio: false } });
    expect(m.here.choices.map((c) => c.id)).toEqual(['visible']);
    const phone = nearbyMenu({ visibility: { quiet: true, levelChosen: true }, can: { quiet: true, radio: true } });
    expect(phone.here.choices.map((c) => c.id)).toEqual(NEARBY_HERE);
    expect(phone.here.selected).toBe('quiet');
    for (const c of phone.here.choices) expect(c.labelKey && c.bodyKey).toBeTruthy();
  });

  it('the chat row says what being out of the chat means; the card switch is not a menu row (it sits in the card editor)', () => {
    const off = nearbyMenu({ visibility: {}, allows: { card: true, chat: false } });
    expect(off.chat).toEqual({ on: false, labelKey: 'circle.nearbyScreen.allow_chat', offKey: 'circle.nearbyScreen.menu_chat_off' });
    expect(nearbyMenu({ allows: { chat: true } }).chat.offKey).toBe(null);
    expect(JSON.stringify(off)).not.toContain('allow_card');
  });
});
