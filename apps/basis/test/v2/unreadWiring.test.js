/**
 * Unread is what OTHERS said (`countsAsUnread`), and the circle you LEAVE is seen (`seenOnLeave`) — the shared rule,
 * wired in both launchers: they pass this person's refs ('me' + `ownAddresses()`) and subscribe the leave to the
 * active-circle signal. A circle you had just made showed "6 unread" before (walk, 2026-10-08).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const WEB = read('../../web/v2/circleApp.js');
const MOBILE = read('../../../basis-mobile/src/screens/v2/CircleLauncherScreen.js');

describe('both launchers wire the unread rule', () => {
  for (const [name, src] of [['web', WEB], ['mobile', MOBILE]]) {
    it(`${name}: the previews get this person's refs`, () => {
      expect(src).toMatch(/buildTilePreviews\(\{[\s\S]{0,200}?myRefs/);
      expect(src).toMatch(/ownAddresses\?\.\(\)/);
    });
    it(`${name}: leaving a circle marks it seen, through the shared signal`, () => {
      expect(src).toMatch(/subscribeActiveCircle\(seenOnLeave\(/);
    });
  }
});
