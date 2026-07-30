/**
 * The wizard kit's palette (2026-07-30).
 *
 * The join sheet was hardcoded light. Theming the SHEET made it dark and left its contents dark grey on
 * dark — "Pick a name", the step labels and the field labels all but unreadable. Theming a container and
 * not its contents is worse than theming neither, because it looks broken rather than plain.
 *
 * Every colour in the kit now comes from one palette, and the sheet's own styles read the same one, so the
 * container and its contents cannot disagree.
 */
import { describe, it, expect } from 'vitest';
import { wizardPalette } from '../../basis/src/rn/wizards/_palette.js';

const DARK = { color: { ink: '#eceade', inkSoft: '#9a9d90', card: '#1e1f1a', consentBg: '#2a221c', line: '#33352c' } };

describe('wizardPalette', () => {
  it('no theme ⇒ exactly the light values it always had', () => {
    const p = wizardPalette(null);
    expect(p.ink).toBe('#222');
    expect(p.card).toBe('#fff');
  });

  it('a dark theme flips the TEXT tones, not just the surfaces', () => {
    // The whole bug: surfaces followed the theme and text did not.
    const p = wizardPalette(DARK);
    expect(p.card).toBe('#1e1f1a');
    expect(p.ink).toBe('#eceade');
    expect(p.inkSoft).toBe('#9a9d90');
    expect(p.inkMuted).toBe('#9a9d90');
  });

  it('ink and card are never the same colour — that is the failure, stated directly', () => {
    for (const theme of [null, DARK, { color: { card: '#000' } }, { color: {} }]) {
      const p = wizardPalette(theme);
      expect(p.ink, `ink === card for ${JSON.stringify(theme)}`).not.toBe(p.card);
    }
  });

  it('text that sits on the accent fill stays light whatever the theme', () => {
    // `stepBubbleTextActive` is on a blue circle in both themes; following `card` would have made it
    // invisible in light mode.
    expect(wizardPalette(DARK).onAccent).toBe('#fff');
    expect(wizardPalette(null).onAccent).toBe('#fff');
  });

  it('a partial theme falls back per key rather than dropping to light wholesale', () => {
    const p = wizardPalette({ color: { card: '#111' } });
    expect(p.card).toBe('#111');
    expect(p.ink).toBe('#222');      // not supplied ⇒ the default, and still != card
  });
});
