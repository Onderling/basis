/**
 * A contact's actions are reachable on a phone.
 *
 * The contact thread's header was ONE row: back · face · title · sealed mark · Hide · "what do they see" · Delete.
 * On a phone that row ran past the right edge, so the three actions were laid out off-screen — absent from the
 * view hierarchy, untappable (found 2026-10-08 on a real phone). An action that cannot be reached does not exist:
 * hiding, inspecting and deleting a contact were impossible on mobile, and the hide note under them showed alone.
 * And neither Contacts nor the thread cleared the status bar, so their titles sat under the clock.
 *
 * `src/screens/**` cannot be rendered under vitest, so this pins the paint as source text: the actions live in
 * their own WRAPPING row (never shrunk off-screen), and both screens take the safe-area top inset.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (name) => readFileSync(fileURLToPath(new URL(`../src/screens/v2/${name}`, import.meta.url)), 'utf8');

describe('the contact thread header', () => {
  const src = read('ContactThreadScreen.js');

  it('the title row ends with who you are here (its tap opens the lens) and the ⋯; the title gives way to both', () => {
    const titleAt = src.indexOf('<Text style={styles.title} numberOfLines={1}');
    const selfAt = src.indexOf('testID="contact-thread-self"');
    const moreAt = src.indexOf('testID="contact-thread-more"');
    expect(titleAt).toBeGreaterThan(-1);
    expect(selfAt, 'the avatar of who you are here').toBeGreaterThan(titleAt);
    expect(moreAt, 'the ⋯').toBeGreaterThan(selfAt);
    expect(src.slice(selfAt - 200, selfAt)).toMatch(/onPress=\{openLens\}/);
  });

  it('the ⋯ reaches Hide / Show (with its note) and Delete: none of the acts is a button that can run off the edge', () => {
    const more = src.slice(src.indexOf('const openMore = useCallback'), src.indexOf('}, [name, hidden, toggleHidden, confirmDelete]);'));
    expect(more).toMatch(/toggleHidden\(\)/);
    expect(more).toMatch(/confirmDelete\(\)/);
    expect(more).toMatch(/circle\.contacts\.hide_note/);
    for (const gone of ['contact-thread-hide"', 'contact-thread-lens"', 'contact-thread-delete"']) expect(src).not.toContain(`testID="${gone}`);
  });

  it('that row wraps rather than running off the screen', () => {
    expect(src).toMatch(/actions:\s*\{[^}]*flexWrap:\s*'wrap'/);
  });

  it('the title gives way (one line, shrinks) instead of pushing what follows off-screen', () => {
    expect(src).toMatch(/<Text style=\{styles\.title\} numberOfLines=\{1\}/);
  });
});

describe('the status bar', () => {
  for (const name of ['ContactThreadScreen.js', 'ContactsScreen.js']) {
    it(`${name} clears it with the safe-area top inset`, () => {
      const src = read(name);
      expect(src).toMatch(/useSafeAreaInsets\(\)/);
      expect(src).toMatch(/paddingTop:\s*16 \+ \(insets\?\.top \?\? 0\)/);
    });
  }
});
