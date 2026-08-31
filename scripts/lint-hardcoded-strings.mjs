#!/usr/bin/env node
/**
 * lint-hardcoded-strings — CLAIM: every word a person reads on a shipping surface comes from a locale
 * file, so switching language is a data change and never a code change.
 *
 * Onderling ships in Dutch and English from one codebase, and the locale files are already at exact
 * parity (1252 keys each). What nothing checked was the other direction: a shell can always write a
 * sentence straight into the DOM, and nothing fails when it does — it simply never translates, and the
 * gap only shows up as one stubborn English line in an otherwise Dutch screen.
 *
 * ── WHY THIS GUARD HAS NO BASELINE ───────────────────────────────────────────────────────────────────
 * Frits, 2026-08-28: *"a strict one that fails right away, baseline must become 0."* It can be strict
 * because it is SCOPED to the surfaces a circle member actually sees, and those are already clean —
 * so it starts green and can only ever catch a NEW one. A guard that begins with a debt list teaches
 * people to add to the debt list.
 *
 * Still outside: `apps/folio/src/server/static/**`, an operator surface rather than a member one — in
 * or out is a scoping call, not a baseline. Widening SCOPE is how anything joins: clean the directory,
 * then add it here. Never by admitting a baseline.
 *
 * ── WHAT COUNTS, AND WHAT DELIBERATELY DOES NOT ──────────────────────────────────────────────────────
 * Only LITERAL PROSE reaching a user-facing sink. A template literal that composes values
 * (`` `${e.icon} ${typeText}: ${e.label}` ``) is not flagged: its words come from the pieces, and those
 * are translated where they are made. Flagging those was the first version's mistake and it produced
 * eight false positives on a surface with no real ones — a guard nobody can trust is worse than none.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';

/**
 * The surfaces a circle member sees. Widen ONE directory at a time, each after it is clean.
 *
 * SCOPE entries are DIRECTORIES, not `**` globs, and that is load-bearing. Written as
 * with a doubled-star segment and a trailing `.js` glob — as they were until 2026-08-31 — git's
 * wildmatch requires an intervening directory, so the pattern matched the wizards under `src/web/` but
 * not one file sitting directly in it, and it matched NOTHING AT ALL under `web/v2/`: every screen the
 * member looks
 * at, `circleApp.js` included, sat outside a guard whose own header says it covers "the surfaces a
 * circle member actually sees". 59 files, and 27 English strings on live web panels — "Close",
 * "Copy", "Claim", "Morning brief", "No events match the current filters." — none of which any of the
 * three greens above could ever have seen. A directory pathspec matches everything beneath it; the
 * `.js` filter below does the narrowing the glob used to pretend to do.
 *
 * `src/web/**` was added 2026-08-28, after a scoping premise of mine turned out to be wrong: I had
 * called it "the older adapter + wizards" and left it out, and it is in fact where the CREATE wizard
 * lives — `circleApp.js` imports `renderCreateGroupWizard` from it and "+ new circle" mounts it. Two
 * greps had "confirmed" the v2 shell did not use it; both excluded `src/web/` from the search, so they
 * could only ever have said that. Thirty-two strings were shipping untranslated to the first screen a
 * person sees when they make a circle.
 */
const SCOPE = [
  'apps/basis/web/v2/',
  'apps/basis/src/web/',
  'apps/basis-mobile/src/',
];

/** Assignment to a sink a person reads. */
const ASSIGN = /\.(textContent|innerText|placeholder|title|ariaLabel|alt)\s*=\s*(['"`])((?:\\.|(?!\2)[^\\])*)\2/g;
/** …and the attribute form. */
const ATTR = /setAttribute\(\s*['"](?:aria-label|title|placeholder|alt)['"]\s*,\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/**
 * The same sinks, in JSX — because the mobile shell has no `.textContent`, and this guard could not
 * see a word of it. `apps/basis-mobile/src/**` had been in SCOPE since the guard was written, which
 * reads as coverage; measured on 2026-08-31 it was vacuous, and seventeen English sentences were
 * shipping to Dutch users out of the RN wizards ("Create a circle", "Members + governance", "Save
 * handle"). A guard whose scope says yes while its detector says nothing is worse than an absent one,
 * because it answers the question people ask of it.
 *
 * Prose only, on the same terms as the DOM half: a literal with a space in it, sitting where a person
 * reads it. `<Text>{expr}</Text>` and `title={t('…')}` are untouched — their words come from elsewhere.
 */
const JSX_TEXT = /<Text\b[^>]*>\s*([A-Z][A-Za-z][^<>{}\n]*\s[^<>{}\n]*)<\/Text>/g;
const JSX_PROP = /\b(?:placeholder|accessibilityLabel|accessibilityHint|title|label)=["']([A-Z][^"']*\s[^"']*)["']/g;

/**
 * Is this literal PROSE a person reads, rather than a key, a token or CSS?
 *
 * Deliberately generous toward "not prose": a false positive costs someone a confusing red build on a
 * line that was fine, and this guard's whole value is that a red means something.
 */
export function isProse(text) {
  if (typeof text !== 'string') return false;
  if (text.includes('${')) return false;              // composed from values — translated at the pieces
  const t = text.trim();
  if (t.length < 3) return false;
  if (!/[A-Za-z]{3}/.test(t)) return false;           // glyphs, punctuation, numbers
  if (/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9_]*)+$/.test(t)) return false;   // a locale key
  if (/^(https?:|data:|blob:|\/|#|\.|@)/.test(t)) return false;             // urls, paths, selectors, css-at
  if (/[{};]|@keyframes|^[a-z-]+\s*:\s*[^ ]+$/i.test(t)) return false;      // css
  if (/^[a-z][a-zA-Z0-9-]*$/.test(t)) return false;   // a single technical token (`button`, `aria-live`)
  // Prose: either more than one word, or a capitalised word of real length. Trailing punctuation
  // counts as part of the sentence — "Copied!" and "Close." are exactly the strings that get typed
  // straight into a shell and never translated.
  return /\s/.test(t) || /^[A-Z][a-zA-Z]{3,}[.!?…]*$/.test(t);
}

export function findHardcoded(files, read = (f) => readFileSync(f, 'utf8')) {
  const hits = [];
  for (const file of files) {
    let src;
    try { src = read(file); } catch { continue; }
    for (const re of [ASSIGN, ATTR, JSX_TEXT, JSX_PROP]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const text = re === ASSIGN ? m[3] : re === ATTR ? m[2] : m[1];
        if (!isProse(text)) continue;
        hits.push({ file, line: src.slice(0, m.index).split('\n').length, text });
      }
    }
  }
  return hits;
}

function tracked() {
  return execSync(`git ls-files ${SCOPE.map((g) => `'${g}'`).join(' ')}`, { encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => !/\.test\.|\/test\//.test(f));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hits = findHardcoded(tracked());
  if (hits.length === 0) {
    console.log('✓ lint-hardcoded-strings — every word on the shipping surfaces comes from a locale file');
    process.exit(0);
  }
  console.error(`✖ lint-hardcoded-strings: ${hits.length} user-facing string(s) written in code:\n`);
  for (const h of hits) console.error(`  ${h.file}:${h.line}\n    ${JSON.stringify(h.text)}`);
  console.error(`
Fix: add the sentence to apps/basis/src/locales/circle.{nl,en}.json and render it through t().
Both languages, or the parity check fails next. A string in code ships untranslated to half the users
and nothing else will ever tell you.`);
  process.exit(1);
}
