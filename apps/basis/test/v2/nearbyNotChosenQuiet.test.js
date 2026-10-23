/**
 * Nobody is listed on Nearby by default: until the room self chose a level, opening the screen browses but never
 * announces. ANNOUNCED ⇔ level chosen ∧ not quiet ∧ radio on. "Later" leaves the device unlisted; choosing a level
 * announces it — but never over the person's own quiet switch or the radio switch.
 */
import { describe, it, expect } from 'vitest';
import { DISCOVERABILITY } from '@onderling/core';
import { createNearbyScreen, nearbyVisibilityKey } from '../../src/v2/nearbyScreen.js';

const settle = () => new Promise((r) => setTimeout(r, 0));

/** A fake control: records every state asked for and reports it back as reached. */
function fakeControl() {
  const asked = [];
  let last = null;
  return {
    asked,
    set(state) { asked.push(state); last = { requested: state, effective: state }; return last; },
    report: () => last,
  };
}

function build({ chosen = false, radio = null } = {}) {
  const control = fakeControl();
  const level = { chosen };
  const screen = createNearbyScreen({ control, radio, levelChosen: () => level.chosen, t: (k) => k });
  return { screen, control, level };
}

const published = (control) => control.asked.includes(DISCOVERABILITY.PUBLISH);

describe('Nearby: not announced until a level is chosen', () => {
  it('open with no level ⇒ quiet (browse only), never PUBLISH; the banner says "not visible yet"', async () => {
    const { screen, control } = build();
    screen.open();
    await settle();
    expect(control.asked).toEqual([DISCOVERABILITY.BROWSE]);
    expect(published(control)).toBe(false);
    expect(screen.visibility()).toMatchObject({ publishing: false, levelChosen: false });
    expect(nearbyVisibilityKey(screen.visibility())).toBe('not_chosen');
    screen.close();
  });

  it('a port that is absent or throws counts as not chosen', async () => {
    for (const levelChosen of [undefined, () => { throw new Error('no disclosure'); }]) {
      const control = fakeControl();
      const screen = createNearbyScreen({ control, levelChosen, t: (k) => k });
      screen.open();
      await settle();
      expect(published(control)).toBe(false);
      screen.close();
    }
  });

  it('choosing a level while open ⇒ announced', async () => {
    const { screen, control, level } = build();
    screen.open();
    level.chosen = true;
    screen.levelChanged();
    await settle();
    expect(control.asked.at(-1)).toBe(DISCOVERABILITY.PUBLISH);
    expect(nearbyVisibilityKey(screen.visibility())).toBe('visible');
    screen.close();
  });

  it('"Later" ⇒ still unlisted; un-quieting does not announce an unchosen self either', async () => {
    const { screen, control } = build();
    screen.open();
    screen.levelChanged();    // a re-read that found nothing chosen (Later only marks the question asked)
    screen.setQuiet(true);
    screen.setQuiet(false);
    await settle();
    expect(published(control)).toBe(false);
    screen.close();
  });

  it('the person\'s own quiet switch outranks choosing a level', async () => {
    const { screen, control, level } = build();
    screen.open();
    screen.setQuiet(true);
    level.chosen = true;
    screen.levelChanged();
    await settle();
    expect(published(control)).toBe(false);
    screen.setQuiet(false);   // their own toggle, exactly as before: now announced
    await settle();
    expect(control.asked.at(-1)).toBe(DISCOVERABILITY.PUBLISH);
    screen.close();
  });

  it('the radio switch outranks choosing a level', async () => {
    let r = 'off';
    const { screen, control, level } = build({ radio: { get: () => r, set: (v) => { r = v; } } });
    screen.open();
    level.chosen = true;
    screen.levelChanged();
    await settle();
    expect(published(control)).toBe(false);
    screen.close();
  });

  it('a self switched to one with no level ⇒ back to unlisted', async () => {
    const { screen, control, level } = build({ chosen: true });
    screen.open();
    await settle();
    expect(control.asked.at(-1)).toBe(DISCOVERABILITY.PUBLISH);
    level.chosen = false;
    screen.levelChanged();
    await settle();
    expect(control.asked.at(-1)).toBe(DISCOVERABILITY.BROWSE);
    screen.close();
  });

  it('the banner never says "not visible yet" while the transports publish or are degraded', () => {
    expect(nearbyVisibilityKey({ levelChosen: false, publishing: true })).toBe('visible');
    expect(nearbyVisibilityKey({ levelChosen: false, degraded: true, publishing: true })).toBe('still_visible');
    expect(nearbyVisibilityKey({ levelChosen: false, radioOff: true })).toBe('radio_off');
    expect(nearbyVisibilityKey({ levelChosen: true, publishing: false })).toBe('hidden');
  });
});
