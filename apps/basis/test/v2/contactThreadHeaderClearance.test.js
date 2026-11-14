/**
 * The contact thread's header keeps the fixed header avatar's room (top-right on every screen), so its ⋯ (Hide, Delete)
 * is never under it. Found on the phone (2026-11-14: a tap on the ⋯ landed on the avatar); web paints the same avatar
 * `position: fixed` and its Contacten head already clears it, the thread header did not.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('../../web/v2/circle.css', import.meta.url)), 'utf8');
const rule = (sel) => (css.match(new RegExp(`\\${sel} \\{([^}]*)\\}`)) ?? [])[1] ?? '';

describe('the thread header beside the header avatar', () => {
  it('clears it as the Contacten head does', () => {
    const room = (rule('.cc-contacts__head').match(/padding-right: (\d+px)/) ?? [])[1];
    expect(room, 'the Contacten head clears the avatar').toBeTruthy();
    expect(rule('.cc-cthread__header')).toMatch(new RegExp(`padding-right: ${room}`));
  });
});
