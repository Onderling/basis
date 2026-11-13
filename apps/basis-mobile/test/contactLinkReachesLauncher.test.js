/**
 * A contact card opened as a link reaches the screen the person sees.
 *
 * The link is drained by the classic chat shell (ChatScreen), which App mounts HIDDEN (pointerEvents none, hidden from
 * accessibility) only for its peer wiring. Its contact branch opened the add sheet and said "added" in its own chat:
 * both invisible, so a card opened as a link did nothing at all (found walking 2026-11-13: received, classified as a
 * contact, then no sheet, no contact). An invite link escapes because it opens a modal wizard; a contact link must be
 * HANDED to the launcher, which opens its own add sheet (the scanner's path).
 *
 * `src/screens/**` cannot be rendered under vitest, so this pins the hand-off as source text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

describe('a contact link reaches the launcher', () => {
  it('the hidden shell hands a contact link on instead of opening its own (invisible) sheet', () => {
    const src = read('src/screens/ChatScreen.js');
    const branch = src.slice(src.indexOf("if (res.kind === 'contact') {"), src.indexOf("if (res.kind === 'enroll') {"));
    expect(branch).toMatch(/onContactLink\(payload\)/);
    // no second door: the hidden shell's own (invisible) add sheet is gone from the link path
    expect(branch).not.toMatch(/addWithSheet/);
  });

  it('nothing the hidden shell says about a link is a chat bubble (it would be invisible): a native alert', () => {
    const src = read('src/screens/ChatScreen.js');
    const handler = src.slice(src.indexOf('async function onQrScanResult(res) {'), src.indexOf('function appendBotText('));
    expect(handler).not.toMatch(/appendBotText\(/);
    expect(handler).toMatch(/sayToPerson\(stashed\.ok \? t\('chat\.scan_enroll_stashed'\)/);
    expect(src).toMatch(/const sayToPerson = \(text\) => \{ try \{ Alert\.alert\(/);
  });

  it('App wires the hand-off from the hidden shell to the launcher', () => {
    const app = read('App.js');
    expect(app).toMatch(/onContactLink=\{onContactLink\}/);
    expect(app).toMatch(/contactLink=\{contactLink\}/);
  });

  it('the launcher opens its own add sheet for it, once', () => {
    const src = read('src/screens/v2/CircleLauncherScreen.js');
    const at = src.indexOf('contactLink?.payload');
    expect(at, 'the launcher reads the handed link').toBeGreaterThan(-1);
    expect(src.slice(at, at + 400)).toMatch(/contactLens\.addWithSheet\(/);
    expect(src.slice(at, at + 400)).toMatch(/onContactLinkDone/);
  });
});
