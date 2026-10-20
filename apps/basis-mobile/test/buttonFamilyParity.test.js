/**
 * The button family — web ≡ mobile, from ONE list: every variant in `BUTTON_VARIANTS` has its `.cc-btn--<variant>`
 * rule in web/v2/circle.css and its look in the phone's `Btn` (btnStyles). RN cannot render under Vitest, so the web
 * side reads the stylesheet.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUTTON_VARIANTS } from '../../basis/src/v2/buttonVariants.js';


describe('the button family, one list on both shells', () => {
  it('web: every variant has its .cc-btn--<variant> rule', () => {
    const css = readFileSync(resolve(__dirname, '../../basis/web/v2/circle.css'), 'utf8');
    for (const v of BUTTON_VARIANTS) expect(css, v).toMatch(new RegExp(`\\.cc-btn--${v}\\b`));
  });
  it("mobile: every variant has its look in Btn, and nothing else", async () => {
    const { btnStyles } = await import('../src/screens/v2/btnStyles.js');
    const color = { ink: '#000', inkSoft: '#555', accent: '#111', accentInk: '#a34', accentContrast: '#fff', danger: '#900' };
    expect(Object.keys(btnStyles({ color })).sort()).toEqual([...BUTTON_VARIANTS].sort());
  });
});
