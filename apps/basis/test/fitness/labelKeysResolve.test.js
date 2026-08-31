/**
 * FITNESS: every shared label map points at locale keys that actually exist, in BOTH languages.
 *
 * Added 2026-07-28 after a label map was written against a namespace that did not exist — the code was
 * fine, the strings were fine, and the UI would have rendered raw key names. Nothing catches that: a
 * missing translation is not an error, it is a string.
 *
 * This is the cheap half of `docs/conventions/shared-vocabularies.md`. It also fails when a locale key is
 * RENAMED and a map is left pointing at the old one, which is the more likely long-run drift.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

import { DELIVERY_LABELS }        from '../../src/v2/deliveryState.js';
import { POINT_SOURCE_LABELS }    from '../../src/v2/connectionPoints.js';
import {
  NEARBY_ACTION_LABELS, NEARBY_ASK_LABELS, NEARBY_INVITE_LABELS,
} from '../../src/v2/nearbyScreen.js';
import { CIRCLE_KINDS }           from '../../src/v2/circleTemplates.js';
import { sharedLocale, mergeShared } from '../../src/locales/index.js';
import { RULES_QUESTIONS }        from '../../src/v2/circleRules.js';
import { ROLE_CONTROL_KEYS }      from '../../src/v2/circleRoleControl.js';

/**
 * Vocabularies whose label keys are built by INTERPOLATION (`circle.kind.${k}`) rather than declared in
 * a map. Nothing had been checking these, and it showed: `CIRCLE_KINDS` gained `team` while the locale did
 * not, so the create wizard offered a fourth circle kind labelled `circle.kind.team` — the raw key, on
 * screen, in both languages. Found by walking S3 on a device (2026-07-29), which is far too late for a
 * missing string. An id list plus a key pattern is a label map with the checking filed off.
 */
const DERIVED = {
  'CIRCLE_KINDS → circle.kind.*': { ids: CIRCLE_KINDS, key: (id) => `circle.kind.${id}` },
  // The rules questions, asked by the create + join wizards on both shells. Their call sites addressed
  // `circle.rules.q.<key>.text` — one level too deep, because the loader collapses every `{text, doc}`
  // leaf to the bare string before i18next ever sees it, so `.text` is not part of the key. Four of the
  // six rendered as raw key names in the create wizard's rules step (walked 2026-08-31); the seventh
  // call site had it right, which is what made the other six look plausible.
  'RULES_QUESTIONS → circle.rules.q.*': {
    ids: RULES_QUESTIONS.map((q) => q.key), key: (id) => `circle.rules.q.${id}`,
  },
};

const MAPS = {
  DELIVERY_LABELS,
  ROLE_CONTROL_KEYS,
  POINT_SOURCE_LABELS,
  NEARBY_ACTION_LABELS,
  NEARBY_ASK_LABELS,
  NEARBY_INVITE_LABELS,
};

/** Resolve a dotted key against a bundle whose leaves are `{ text, doc }`. */
function lookup(bundle, dotted) {
  // Keys are authored as `circle.a.b`; the bundle itself IS `circle`.
  const parts = dotted.replace(/^circle\./, '').split('.');
  let node = bundle;
  for (const p of parts) {
    if (!node || typeof node !== 'object') return null;
    node = node[p];
  }
  return typeof node?.text === 'string' ? node.text : null;
}

for (const lang of ['en', 'nl']) {
  describe(`FITNESS: shared label maps resolve in ${lang}`, () => {
    const bundle = JSON.parse(readFileSync(
      new URL(`../../src/locales/circle.${lang}.json`, import.meta.url), 'utf8',
    ));

    for (const [name, { ids, key }] of Object.entries(DERIVED)) {
      it(`${name} — every id has a label`, () => {
        const missing = ids.filter((id) => !lookup(bundle, key(id))).map((id) => key(id));
        expect(missing, `${name}: these ${lang} keys would render as raw keys on screen`).toEqual([]);
      });
    }

    for (const [name, map] of Object.entries(MAPS)) {
      it(`${name} — every key exists and is non-empty`, () => {
        const missing = Object.entries(map)
          .filter(([, key]) => !lookup(bundle, key))
          .map(([id, key]) => `${id} → ${key}`);
        expect(missing, `${name} points at ${lang} keys that do not exist`).toEqual([]);
      });

      it(`${name} — is frozen, so a renderer cannot mutate it`, () => {
        expect(Object.isFrozen(map)).toBe(true);
      });
    }
  });
}

/**
 * FITNESS (2026-08-31): every STATIC `t('…')` key in the shells resolves to real copy, in both languages.
 *
 * The map check above catches a label VOCABULARY pointing at a dead key. It cannot catch the far more
 * common shape: a `t()` call written against a namespace that does not exist. That is not an error
 * anywhere — i18next returns the key, so the UI renders `wizard.create.name` and the app looks broken
 * rather than untranslated.
 *
 * Found by walking the create-circle wizard on 2026-08-31: all 32 of its labels rendered as raw keys,
 * and so did the settings, dispute, backup, restore and audience wizards — 55 keys. The copy existed the
 * whole time. It lives in the SHARED circle block (`src/locales/circle.*.json`), which every shell merges
 * under the `circle` namespace, so the keys are `circle.wizard.create.name`; the call sites had dropped
 * the prefix. One character of namespace, six wizards dark, and nothing failed.
 *
 * WHY IT RESOLVES PER SHELL: each shell merges its OWN app bundle with the three shared blocks —
 * web `apps/basis/locales/*.json`, mobile `apps/basis-mobile/locales/*.json` (see the two
 * `localisation.js` files). A key is checked against the bundles of the shells that can actually render
 * the file it appears in: `src/web/**` + `web/**` are web, `src/rn/**` and the mobile app are mobile,
 * and everything else is shared code that must resolve in BOTH.
 */
// The shared half comes from the SEAM, not from a list of block names re-typed here. When
// `src/locales/host.*` landed, this guard's own copy of that list did not know about it and 470 keys
// "stopped resolving" — the guard reporting the shape of its own staleness. A test that re-implements
// the thing it is guarding will eventually guard the wrong thing.

/** Where each shell's own bundle lives, relative to the repo root. */
const SHELLS = {
  web: 'apps/basis/locales',
  mob: 'apps/basis-mobile/locales',
};

/**
 * Shared files whose strings were only ever added to ONE shell's bundle.
 *
 * **Empty since 2026-08-31, and that is the point.** It held two entries: `localBuiltins.js` (the
 * slash-command replies) and `handlers/mediaEmbed.js` — about a hundred strings that shared code
 * wrote and only the web bundle had, so `/mute` on a phone answered with the string "mute.added".
 * Both went away when the shared blocks moved into `src/locales/host.*`; nothing is exempt now, and a
 * new entry here should be argued for rather than added.
 */
const KNOWN_SHELL_GAPS = {};

const ROOT = new URL('../../../../', import.meta.url);   // apps/basis/test/fitness → repo root
const SCAN = ['apps/basis/src', 'apps/basis/web', 'apps/basis-mobile/src'];

/**
 * A translate call with a static, single-quoted key — under every ALIAS this tree actually uses.
 *
 * `t(` alone misses about a third of the call surface (measured 2026-08-31: 1398 sites seen, 1994
 * present). Shared modules take their translator by injection and almost always name it `tr` — 570
 * static sites — so the code this guard most needs to watch was the code it could not see. `tt(` is
 * one module's local alias, and `ctx.t(` / `opts.t(` are the two call-through shapes. An interpolated
 * key still cannot be checked statically; those are covered by the derived-key maps above.
 */
const T_CALL = /(?:(?:^|[^A-Za-z0-9_.$])(?:t|tr|tt)|\b(?:ctx|opts)\.t)\(\s*'([A-Za-z0-9_.\-]+)'/gm;

/**
 * The call surface this scanner is expected to see. A floor, not an exact count: it fails loudly if a
 * future alias slips past the regex (the number drops) rather than going quiet, which is exactly how
 * the `tr(` blind spot survived unnoticed.
 */
const MIN_CALL_SITES = 1900;

/**
 * The whole call text from `t(` to its matching `)`, by paren balance rather than "up to the next `)`" —
 * an argument like `{ error: String(e), defaultValue: 'x' }` closes a paren of its own halfway through,
 * and a naive scan stops there and never sees the `defaultValue` that makes the call safe.
 */
function callTextAt(src, keyEnd) {
  let depth = 1;
  for (let i = src.indexOf('(', keyEnd - 40) + 1 || keyEnd; i < src.length && i < keyEnd + 600; i += 1) {
    if (src[i] === '(') depth += 1;
    else if (src[i] === ')') { depth -= 1; if (depth === 0) return src.slice(keyEnd, i); }
  }
  return src.slice(keyEnd, keyEnd + 600);
}

function walkJs(dir, out = []) {
  let entries = [];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const full = `${dir}/${e.name}`;
    if (e.isDirectory()) walkJs(full, out);
    else if (/\.(js|jsx)$/.test(e.name)) out.push(full);
  }
  return out;
}

/** Which shells can render this file — the mirror of how the two shells compose their bundles. */
function shellsFor(rel) {
  if (rel.startsWith('apps/basis/src/web/') || rel.startsWith('apps/basis/web/')) return ['web'];
  if (rel.startsWith('apps/basis/src/rn/') || rel.startsWith('apps/basis-mobile/')) return ['mob'];
  return ['web', 'mob'];
}

/** A key resolves when it lands on a `{text}` leaf (or a bare string) — a branch is not copy. */
function resolvesIn(tree, key) {
  let node = tree;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object' || !(part in node)) return false;
    node = node[part];
  }
  return typeof node === 'string' || typeof node?.text === 'string';
}

const bundles = {};
for (const [shell, dir] of Object.entries(SHELLS)) {
  for (const lang of ['en', 'nl']) {
    let own;
    try { own = JSON.parse(readFileSync(new URL(`${dir}/${lang}.json`, ROOT), 'utf8')); }
    catch { continue; }   // a shell that is not checked out is skipped, never a false red
    // `mergeShared`, not a spread — the shells merge one level deeper, and a spread here would
    // REPLACE a shell's whole `chat`/`common`/`logs` block with the shared one, hiding 45 keys the
    // phone really has. (It did, the moment those blocks became partly shared.)
    bundles[`${shell}.${lang}`] = mergeShared(own, sharedLocale[lang]);
  }
}

describe('FITNESS: every static t() key resolves in both languages, in every shell that renders it', () => {
  const files = SCAN.flatMap((d) => walkJs(new URL(d, ROOT).pathname))
    .map((abs) => abs.slice(new URL('.', ROOT).pathname.length));

  it('finds source to scan (the walk itself is load-bearing)', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it(`sees at least ${MIN_CALL_SITES} translate calls — a shrinking number means an alias slipped past`, () => {
    let sites = 0;
    for (const rel of files) {
      for (const _ of readFileSync(new URL(rel, ROOT), 'utf8').matchAll(T_CALL)) sites += 1;
    }
    expect(sites, 'the scanner stopped seeing calls it used to see — check for a new translator alias')
      .toBeGreaterThanOrEqual(MIN_CALL_SITES);
  });

  it('no t() call renders its own key name', () => {
    const dead = [];
    for (const rel of files) {
      const src = readFileSync(new URL(rel, ROOT), 'utf8');
      for (const m of src.matchAll(T_CALL)) {
        const key = m[1];
        // `defaultValue` is i18next's own fallback: such a call renders copy even with no entry.
        if (callTextAt(src, m.index + m[0].length).includes('defaultValue')) continue;
        const gap = KNOWN_SHELL_GAPS[rel] ?? [];
        for (const shell of shellsFor(rel).filter((s) => !gap.includes(s))) {
          for (const lang of ['en', 'nl']) {
            const bundle = bundles[`${shell}.${lang}`];
            if (bundle && !resolvesIn(bundle, key)) dead.push(`${key}  (${shell}/${lang})  ${rel}`);
          }
        }
      }
    }
    expect([...new Set(dead)].sort(), 'these keys would render as raw key names on screen').toEqual([]);
  });
});
