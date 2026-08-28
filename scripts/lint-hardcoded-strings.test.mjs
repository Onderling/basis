/**
 * Self-test for the hardcoded-strings guard (a guard whose test is red is not a guard —
 * guards.mjs runs `vitest run scripts/`).
 *
 * The part worth testing is not that it passes on a clean tree — it is that it goes RED on a real
 * hardcoded sentence and stays QUIET on the four things that look like one and are not. This guard's
 * first version flagged eight template literals on a surface with no real violations, and a guard
 * people learn to ignore is worse than no guard.
 */
import { describe, it, expect } from 'vitest';
import { isProse, findHardcoded } from './lint-hardcoded-strings.mjs';

describe('what counts as a user-facing sentence', () => {
  it('catches prose', () => {
    expect(isProse('You are no longer a member')).toBe(true);
    expect(isProse('Sluiten')).toBe(true);            // one capitalised real word
    expect(isProse('Copied!')).toBe(true);
  });

  it('ignores a value composed from pieces — the false-positive class', () => {
    // The words come from the pieces, and those are translated where they are made.
    expect(isProse('${e.icon} ${typeText}: ${e.label}')).toBe(false);
    expect(isProse('${c.id} (${c.count})')).toBe(false);
  });

  it('ignores locale keys, tokens, css and urls', () => {
    expect(isProse('circle.chat.app_sender')).toBe(false);
    expect(isProse('button')).toBe(false);
    expect(isProse('aria-live')).toBe(false);
    expect(isProse('@keyframes cc-pulse{0%{transform:scale(1)}}')).toBe(false);
    expect(isProse('https://example.org/x')).toBe(false);
    expect(isProse('  ')).toBe(false);
    expect(isProse('· 12')).toBe(false);
  });
});

describe('the guard itself', () => {
  const read = (src) => () => src;

  it('goes RED on a sentence assigned to a text sink', () => {
    const hits = findHardcoded(['x.js'], read("el.textContent = 'You were removed from this circle';"));
    expect(hits).toHaveLength(1);
    expect(hits[0].text).toBe('You were removed from this circle');
  });

  it('goes RED on an aria-label written in code', () => {
    const hits = findHardcoded(['x.js'], read("el.setAttribute('aria-label', 'Close this dialog');"));
    expect(hits).toHaveLength(1);
  });

  it('stays QUIET on the same sink fed from t()', () => {
    expect(findHardcoded(['x.js'], read("el.textContent = t('circle.chat.app_sender');"))).toHaveLength(0);
  });

  it('stays QUIET on a composed template literal', () => {
    expect(findHardcoded(['x.js'], read('el.textContent = `${a} — ${b}`;'))).toHaveLength(0);
  });

  it('reports the LINE, so a red names its own fix site', () => {
    const hits = findHardcoded(['x.js'], read("const a = 1;\nconst b = 2;\nel.title = 'Remove this member';"));
    expect(hits[0].line).toBe(3);
  });
});
