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

  it('goes RED on a dialog button labelled in code — the DIALOG sink (Alert.alert and kin)', () => {
    const src = "Alert.alert(\n  t('circle.tile.menu.leave'),\n  t('x.y'),\n  [\n    { text: 'Cancel', style: 'cancel' },\n    { text: t('a.b'), style: 'destructive' },\n  ],\n);";
    const hits = findHardcoded(['x.js'], read(src));
    expect(hits.map((h) => h.text)).toEqual(['Cancel']);
    expect(hits[0].line).toBe(5);
  });

  it('…and on the browser dialogs (prompt / confirm / alert) with a sentence, never on their t() form', () => {
    expect(findHardcoded(['x.js'], read("const v = globalThis.prompt?.('Your name please');"))).toHaveLength(1);
    expect(findHardcoded(['x.js'], read("if (window.confirm('Delete this circle?')) go();"))).toHaveLength(1);
    expect(findHardcoded(['x.js'], read("const v = globalThis.prompt?.(t('circle.x.prompt'));"))).toHaveLength(0);
    expect(findHardcoded(['x.js'], read("ToastAndroid.show(t('a.b'), ToastAndroid.SHORT);"))).toHaveLength(0);
  });
});

describe('the wizard kit positions (a label handed to a helper becomes the screen)', () => {
  const read = (src) => () => src;
  const hits = (src) => findHardcoded(['x.js'], read(src)).map((h) => h.text);
  it('flags English handed to the web kit, and passes it keyed', () => {
    expect(hits("mkField(body, doc, 'Passphrase', state.p, onIn);")).toEqual(['Passphrase']);
    expect(hits("mkActions(c, doc, [{ label: 'Cancel', onClick }]);")).toEqual(['Cancel']);
    expect(hits("mkSteps(c, doc, ['Mnemonic', 'Confirm'], 1);")).toEqual(['Mnemonic', 'Confirm']);
    expect(hits("mkField(b, doc, t('a.b'), v, f, { placeholder: 'e.g. plumbing', hint: 'Words separated by spaces.' });"))
      .toEqual(['e.g. plumbing', 'Words separated by spaces.']);
    expect(hits("mkField(body, doc, t('a.b'), v, f, { placeholder: t('a.c') }); mkActions(c, doc, [{ label: t('common.cancel') }]);")).toEqual([]);
  });
  it('flags the phone kit too: Steps labels, one-word JSX props, lowercase placeholders', () => {
    expect(hits("<Steps labels={['Passphrase', 'Save']} current={1} />")).toEqual(['Passphrase', 'Save']);
    expect(hits('<Field label="Kind" />')).toEqual(['Kind']);
    expect(hits('<Field placeholder="e.g. alice" />')).toEqual(['e.g. alice']);
    expect(hits("<Field label={t('a.b')} placeholder={t('a.c')} />")).toEqual([]);
  });
});
