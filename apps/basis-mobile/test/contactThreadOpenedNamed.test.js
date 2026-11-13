/**
 * A thread opened from a notice is the person Contacten shows, and nothing lies over its header.
 *
 * Found walking messaging on the emulator (2026-11-14): a circle member's first message raised the notify banner
 * ("Someone: …") while the person was on Contacten. They opened the thread from the row (titled with the name), the
 * banner stayed over the header, and a tap on the ⋯ landed on the banner, which reopened the thread from its id alone:
 * `{ contactId, name: null }`, so "Chat with Unknown". The tab frame's avatar also sat over the ⋯. Web opens a thread
 * by id through the row Contacten paints (circleApp showContactThread); the phone now does the same.
 *
 * `src/screens/**` cannot be rendered under vitest, so this pins the launcher as source text.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = readFileSync(fileURLToPath(new URL('../src/screens/v2/CircleLauncherScreen.js', import.meta.url)), 'utf8');

describe('a thread opened from a notice', () => {
  it('is opened by id through the row Contacten paints, never as a bare id with no name', () => {
    expect(src).toMatch(/const openContactThreadById = useCallback\(async \(contactId, \{ draft = null, name = null \} = \{\}\) => \{/);
    expect(src).not.toMatch(/openContactThread\(\{ contactId: [^}]*name: null \}\)/);
    expect(src).not.toMatch(/openContactThread\(\{ contactId: a\.row\.open\.id/);
    // the banner, Today's "new for you" row and the feedback door all take the one path
    expect((src.match(/openContactThreadById\(/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it('a banner for the thread that is now open goes away', () => {
    expect(src).toMatch(/useEffect\(\(\) => \{ bannerRef\.current\?\.recheck\(\); \}, \[openThreadId, openCircleId\]\);/);
    const web = readFileSync(fileURLToPath(new URL('../../basis/web/v2/circleApp.js', import.meta.url)), 'utf8');
    expect((web.match(/_banner\?\.recheck\(\);/g) ?? []).length, 'web rechecks on the open thread and the open circle').toBe(2);
  });

  it('the thread\'s header row keeps the frame avatar\'s room, so its ⋯ is never under it', () => {
    const thread = readFileSync(fileURLToPath(new URL('../src/screens/v2/ContactThreadScreen.js', import.meta.url)), 'utf8');
    expect(thread).toMatch(/header: \{[^}]*paddingRight: HEADER_AVATAR_SIDE_CLEARANCE \}/);
  });
});
