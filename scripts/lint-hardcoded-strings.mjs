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
  // the phone's wizards are drawn from here (the mobile shell imports them) — outside the scope until 2026-10-22,
  // the same blind spot src/web/ had: 44 English labels shipped untranslated to the create wizard and five others
  'apps/basis/src/rn/',
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
// A capitalised value; isProse decides whether it is prose — one word counts too (`label="Kind"`, `label="Posting…"`
// went through when this demanded a space).
const JSX_PROP = /\b(?:placeholder|accessibilityLabel|accessibilityHint|title|label|intro|hint)=["']([A-Z][^"']*)["']/g;

/**
 * The REPORT-BUILDER shape: a literal pushed onto an array, or standing alone as an array element.
 *
 * Every sink above is a moment where one string meets one element. This is the other way a screen gets
 * written — a function assembling a whole page of prose into a list and joining it at the end, touching
 * no DOM node and no JSX prop on the way. Both shells do it (a wizard's step copy, a diagnostic report),
 * and none of the detectors above can see a word of it.
 *
 * Added 2026-08-31, after the web wizards' step titles and intros were found hardcoded in exactly this
 * shape — twenty-two English sentences in a Dutch app, in the wizard where a person replaces their
 * identity. The DOM sinks had been green over them since the guard was written.
 */
const LINES = /(?:\.push\(|^[ \t]*)(['"])((?:\\.|(?!\1)[^\\])*)\1\s*[,)]/gm;

/**
 * The DIALOG sink: a native or browser dialog a person reads and answers — `Alert.alert(title, message, buttons)`,
 * `ToastAndroid.show(…)`, `prompt(…)` / `confirm(…)` / `alert(…)`. Its words sit anywhere in the call (a button's
 * `{ text: 'Cancel' }` three lines down), so the whole balanced argument span is read, every literal in it judged by
 * `isProse` (a `t('key')` key, a `style: 'cancel'` token pass). Added 2026-10-19 (Frits: every UI string from the
 * locale files) — two mobile confirm dialogs shipped an English "Cancel" the JSX and DOM sinks never saw.
 */
const DIALOG_OPEN = /(?:\bAlert\.(?:alert|prompt)|\bToastAndroid\.show(?:WithGravity)?|(?:\b(?:globalThis|window)\??\.)?\b(?:prompt|confirm|alert)\??\.?)\(/g;
const STRING_LIT = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;

/**
 * The WIZARD KIT sink (src/web/wizards/_wizardKit.js): a label handed to a helper becomes the text on the screen, and no
 * DOM assignment in the calling file ever shows it. The web wizards went in as `mkField(body, doc, 'Passphrase', …)`,
 * `mkActions(…, [{ label: 'Cancel' }])`, `mkSteps(…, ['Mnemonic', …])` — dozens of English words this guard could not see
 * until 2026-10-22, while the phone's twins of the same wizards were keyed. The positions: the text after `doc` in
 * mkField / mkTextarea / mkCheck / mkRadioGroup / mkBody (both of mkBody's), a `label:`, `placeholder:` or `hint:` in any object (buttons, radio
 * options, a field's extras), a JSX `placeholder="…"` in either case, and every string in a mkSteps list or the phone's `<Steps labels={[…]}>`.
 */
const KIT_ARG = /\bmk(?:Field|Textarea|Check|RadioGroup|Body|Submitting)\(\s*(?:[\w.]+\s*,\s*)?doc\s*,\s*(?:[\w.]+\s*,\s*)?(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
const MKBODY_BLURB = /\bmkBody\(\s*doc\s*,\s*[^,]+,\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
const LABEL_PROP = /\b(?:label|placeholder|hint)\s*:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/g;
const MKSTEPS = /\bmkSteps\(\s*[\w.]+\s*,\s*doc\s*,\s*\[([^\]]*)\]/g;
// …and the phone kit's twin, `<Steps labels={['Mnemonic', …]} />`
const STEPS_PROP = /\blabels=\{\[([^\]]*)\]\}/g;
// …and a JSX placeholder in any case: `placeholder="e.g. plumbing"` starts lowercase, which JSX_PROP (capitals only) misses
const JSX_PLACEHOLDER = /\bplaceholder="([^"]*)"/g;
function kitHits(src) {
  const out = [];
  for (const re of [KIT_ARG, MKBODY_BLURB, LABEL_PROP]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) out.push({ index: m.index, text: m[2] });
  }
  JSX_PLACEHOLDER.lastIndex = 0;
  for (let m; (m = JSX_PLACEHOLDER.exec(src));) out.push({ index: m.index, text: m[1] });
  for (const re of [MKSTEPS, STEPS_PROP]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src))) {
      STRING_LIT.lastIndex = 0;
      let s;
      while ((s = STRING_LIT.exec(m[1]))) out.push({ index: m.index, text: s[2] });
    }
  }
  return out;
}
function dialogHits(src) {
  const out = [];
  DIALOG_OPEN.lastIndex = 0;
  let m;
  while ((m = DIALOG_OPEN.exec(src))) {
    if (/[\w$.]$/.test(src.slice(Math.max(0, m.index - 1), m.index)) && !/^(?:Alert|ToastAndroid|globalThis|window)/.test(m[0])) continue;   // `foo.prompt(` / `myalert(` are not the dialog
    // Walk the call's arguments. What a person reads is a literal AT THE CALL'S OWN LEVEL — an argument, an array
    // element, an object value under `text`/`title`/`message` — never one inside a nested call (`t('key')`,
    // `console.warn(…)`) or an arrow function's body (`onPress: () => { … }`), and never a comment.
    let depth = 1; let i = m.index + m[0].length; let lastKey = null; let prev = '(';
    const skipString = (k) => { const q = src[k]; let x = k + 1; while (x < src.length && src[x] !== q) { if (src[x] === '\\') x += 1; x += 1; } return x; };
    const skipBlock = (k, open, close) => { let d = 0; for (let x = k; x < src.length; x += 1) { const c = src[x]; if (c === "'" || c === '"' || c === '`') { x = skipString(x); continue; } if (c === '/' && src[x + 1] === '/') { x = src.indexOf('\n', x); if (x < 0) return src.length; continue; } if (c === open) d += 1; else if (c === close) { d -= 1; if (d === 0) return x; } } return src.length; };
    for (; i < src.length && depth > 0; i += 1) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
      if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 1; continue; }
      if (c === '=' && src[i + 1] === '>') {   // an arrow function's body is code, not the dialog's words
        let k = i + 2; while (/\s/.test(src[k] ?? '')) k += 1;
        if (src[k] === '{') { i = skipBlock(k, '{', '}'); }
        else { let d = 0; for (; k < src.length; k += 1) { const ch = src[k]; if (ch === "'" || ch === '"' || ch === '`') { k = skipString(k); continue; } if (ch === '(' || ch === '[' || ch === '{') d += 1; else if (ch === ')' || ch === ']' || ch === '}') { if (d === 0) break; d -= 1; } else if (ch === ',' && d === 0) break; } i = k - 1; }
        prev = ')'; continue;
      }
      if (c === "'" || c === '"' || c === '`') {
        const end = skipString(i);
        const keyed = prev === ':' ? lastKey : null;
        if (depth === 1 && (prev !== ':' || /^(?:text|title|message)$/.test(keyed ?? ''))) out.push({ index: i, text: src.slice(i + 1, end) });
        i = end; prev = 'str'; continue;
      }
      if (c === '(') { if (depth >= 1 && !/\s/.test(c)) { i = skipBlock(i, '(', ')'); prev = ')'; continue; } }
      if (c === ')') { depth -= 1; continue; }
      if (/[A-Za-z_$]/.test(c)) { let k = i; while (/[\w$]/.test(src[k] ?? '')) k += 1; lastKey = src.slice(i, k); i = k - 1; prev = 'id'; continue; }
      if (!/\s/.test(c)) prev = c;
    }
  }
  return out;
}

/**
 * A literal that is only ever thrown is a message to whoever is reading a stack trace, not to a person
 * using the app — the one place in this file where the SINK, not the string, decides. Kept narrow: it
 * looks just behind the match, so a sentence that happens to sit near a throw is still caught.
 */
function isThrown(src, index) {
  return /\bthrow new [A-Za-z]*Error\(\s*$/.test(src.slice(Math.max(0, index - 80), index));
}

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
  if (/^[A-Z][A-Z0-9-]*$/.test(t)) return false;      // …and its shouted twin (`PURGE`, `M-SEARCH`) — a
                                                      // protocol constant, which is what an all-caps word
                                                      // with no lowercase in it always turns out to be.
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
    for (const re of [ASSIGN, ATTR, JSX_TEXT, JSX_PROP, LINES]) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(src))) {
        const text = re === ASSIGN ? m[3] : (re === ATTR || re === LINES) ? m[2] : m[1];
        if (!isProse(text)) continue;
        if (re === LINES && isThrown(src, m.index)) continue;
        hits.push({ file, line: src.slice(0, m.index).split('\n').length, text });
      }
    }
    for (const k of kitHits(src)) {
      if (!isProse(k.text)) continue;
      hits.push({ file, line: src.slice(0, k.index).split('\n').length, text: k.text });
    }
    for (const d of dialogHits(src)) {
      if (!isProse(d.text)) continue;
      // a literal that is the KEY of a t() call inside the dialog is not prose (isProse already passes dotted keys)
      hits.push({ file, line: src.slice(0, d.index).split('\n').length, text: d.text });
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
