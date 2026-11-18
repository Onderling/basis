// A box spec reads the box's card from its output. `device-runner: up` is printed a few lines before the card, in its
// own write, so "up" alone is not "the card is there": a spec that waited for "up" read the output in between once and
// found no card (screen-admin-box.spec.js, 2026-11-17).
import { describe, it, expect } from 'vitest';
import { boxIsUp } from './support/addBoxCard.js';

describe('the box is up and has printed its card', () => {
  const up = '\ndevice-runner: up — data in /tmp/x\n  log       0 entries restored from disk\n';
  const card = '  Contact card:\n    onderling-contact://AbC_d-12\n';

  it('"up" alone, the card still to come: not yet', () => {
    expect(boxIsUp(up)).toBe(false);
  });

  it('a card cut off mid-write: not yet', () => {
    expect(boxIsUp(`${up}  Contact card:\n    onderling-contact://AbC`)).toBe(false);
  });

  it('"up" and the whole card line: yes', () => {
    expect(boxIsUp(up + card)).toBe(true);
  });
});
