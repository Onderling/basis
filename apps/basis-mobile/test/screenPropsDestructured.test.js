/**
 * FITNESS — every prop App.js hands a screen must be DESTRUCTURED by that screen.
 *
 * This is the guard for the bug that broke every circle-open on 2026-07-30, and it is worth having because
 * the failure is completely silent at the layer where the mistake is made.
 *
 * `App.js` passed `onAcceptFallback={acceptFallbackOffer}` to `CircleLauncherScreen`. The launcher's own
 * parameter list never mentioned it — only its child's did — so the render at ~1733 forwarded a bare
 * `onAcceptFallback` that existed in no scope. Opening ANY circle threw
 * `Property 'onAcceptFallback' doesn't exist`, React aborted the render, and the list stayed put.
 *
 * What made it expensive: it reads as a dead tap. The press handler runs, `openCircle` runs, skills fire —
 * and then the render it causes throws, so there is no navigation and nothing obviously wrong in the log. It
 * cost a probe on the Pressable to discover the handler had been working the whole time. `src/screens/**` is
 * excluded from vitest (see `docs/agent-notes-known-gotchas.md`), so nothing else was ever going to catch it,
 * which is exactly why CLAUDE.md says to grep every identifier you introduce against the file you put it in.
 *
 * Static analysis on purpose: importing these screens means importing the whole agent. The prop names are
 * right there in the text, and a name mismatch is all this needs to see.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appJs = readFileSync(path.join(here, '..', 'App.js'), 'utf-8');

const SCREENS = [
  { tag: 'ChatScreen', file: path.join(here, '..', 'src', 'screens', 'ChatScreen.js') },
  { tag: 'CircleLauncherScreen', file: path.join(here, '..', 'src', 'screens', 'v2', 'CircleLauncherScreen.js') },
];

/** The prop names in a JSX usage — `<Tag  foo={...} bar={...} />`. */
function propsPassedTo(tag, source) {
  const open = source.indexOf(`<${tag}`);
  if (open === -1) return null;
  // The tag body ends at the first `/>` that closes it. These usages are self-closing in App.js; a
  // non-self-closing one would need a real parser, so assert the shape rather than guess at it.
  const end = source.indexOf('/>', open);
  if (end === -1) return null;
  const body = source.slice(open + tag.length + 1, end);
  const names = new Set();
  for (const m of body.matchAll(/(?:^|\s)([a-zA-Z_$][\w$]*)=\{/g)) names.add(m[1]);
  return names;
}

/** The names a component destructures out of its props object. */
function propsDeclaredBy(tag, source) {
  const sig = source.indexOf(`export default function ${tag}({`);
  if (sig === -1) return null;
  const start = source.indexOf('({', sig) + 2;
  // Walk to the brace that closes the destructuring pattern, so nested defaults do not end it early.
  let depth = 1;
  let i = start;
  while (i < source.length && depth > 0) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
    i += 1;
  }
  const block = source.slice(start, i - 1);
  const names = new Set();
  // Top-level keys only: `name`, `name = default`, `name: alias`.
  let d = 0;
  for (const line of block.split('\n')) {
    const trimmed = line.trim();
    if (d === 0 && !trimmed.startsWith('//')) {
      const m = /^([a-zA-Z_$][\w$]*)\s*(?:[=:,]|$)/.exec(trimmed);
      if (m) names.add(m[1]);
    }
    for (const ch of line) {
      if (ch === '{' || ch === '[') d += 1;
      else if (ch === '}' || ch === ']') d -= 1;
    }
  }
  return names;
}

describe.each(SCREENS)('FITNESS: $tag receives what App.js sends', ({ tag, file }) => {
  const source = readFileSync(file, 'utf-8');

  it('is rendered by App.js in a shape this guard can read', () => {
    expect(propsPassedTo(tag, appJs), `no self-closing <${tag} …/> found in App.js`).toBeTruthy();
    expect(propsDeclaredBy(tag, source), `no destructuring signature found in ${tag}`).toBeTruthy();
  });

  it('destructures every prop it is passed', () => {
    const passed = propsPassedTo(tag, appJs);
    const declared = propsDeclaredBy(tag, source);
    const missing = [...passed].filter((n) => !declared.has(n));
    expect(
      missing,
      `App.js passes these to ${tag} and ${tag} never destructures them, so referencing one is a `
      + 'ReferenceError at render — silent until the branch that uses it renders. Add them to the '
      + 'parameter list (or stop passing them).',
    ).toEqual([]);
  });
});

describe('the two props from the 2026-07-30 breakage in particular', () => {
  // Named explicitly so a future refactor that drops one fails loudly rather than reintroducing a dead tap.
  const launcher = readFileSync(SCREENS[1].file, 'utf-8');

  it('CircleLauncherScreen destructures onAcceptFallback — the one that threw', () => {
    expect(propsDeclaredBy('CircleLauncherScreen', launcher).has('onAcceptFallback')).toBe(true);
  });

  it('…and circlesRevision, so a circle joined elsewhere reaches its list', () => {
    expect(propsDeclaredBy('CircleLauncherScreen', launcher).has('circlesRevision')).toBe(true);
    // It has to be a DEPENDENCY of the load effect, not merely accepted — otherwise the counter changes
    // and nothing reloads, which is the same invisible failure one level up.
    expect(launcher).toMatch(/\[load, callSkill, circlesRevision\]/);
  });

  it('ChatScreen destructures onCirclesChanged, the other half of that wire', () => {
    const chat = readFileSync(SCREENS[0].file, 'utf-8');
    expect(propsDeclaredBy('ChatScreen', chat).has('onCirclesChanged')).toBe(true);
  });
});
