#!/usr/bin/env node
/**
 * lint-op-descriptions — every op, and every op parameter, is described in words a PERSON reads, in both languages, in
 * a file beside its app's manifest (the assistant plan's step C, ledger L1025; the 2026-07-31 rule: natural-language
 * descriptions get their own locale-shaped file).
 *
 *   apps/<app>/descriptions.en.json · apps/<app>/descriptions.nl.json
 *   { "<opId>": { "what": "<a sentence a person reads>", "params": { "<param>": "<a short phrase>" } } }
 *
 * `what` is the person's text ("/" shows it, help answers "what does X do" with it); the MODEL's text stays the op's
 * `surfaces.chat.hint` (and `chat-hints.nl.json`): two texts, as Frits agreed.
 *
 * Red when, for an app that has its files: an op or a param has no text in either language; an entry names an op or a
 * param the manifest does not declare (no orphans); a `what` is over 20 words or a phrase over 8; a text has a dash.
 * And: an app with no files that is not in the baseline; a baseline app that now has its files or no manifest. The
 * baseline (`scripts/op-descriptions-baseline.json`, the apps still owed their words) only shrinks: one app per PR.
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { allManifests } from '../apps/basis/src/v2/manifestSources.js';
// the words the app READS (the reader's registry): an app counts as described only when its files are imported there
import { OP_DESCRIPTIONS, genericVerbWords, opDescription } from '../apps/basis/src/v2/opDescriptions.js';
import { capabilitiesOf } from '../packages/app-manifest/src/index.js';
import { manifestFileByApp, MANIFEST_LIST } from './guard-where.mjs';

/** The nouns with generic ops (a capability with no op of its own), `[{app, noun, atoms}]`, and their names. */
export function genericNouns(manifests = allManifests()) {
  const generic = [];
  const names = {};
  for (const m of manifests) {
    let caps = [];
    try { caps = capabilitiesOf(m); } catch { continue; }
    const byNoun = new Map();
    for (const c of caps) if (!c.opId && c.noun && c.atom) byNoun.set(c.noun, [...(byNoun.get(c.noun) ?? []), c.atom]);
    for (const [noun, atoms] of byNoun) {
      generic.push({ app: m.app, noun, atoms: [...new Set(atoms)] });
      if (m.nouns?.[noun]?.names) names[`${m.app}.${noun}`] = m.nouns[noun].names;
    }
  }
  return { generic, names };
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASELINE = path.join(HERE, 'op-descriptions-baseline.json');
const LANGS = ['en', 'nl'];
const MAX_WHAT = 20;
const MAX_PHRASE = 8;
// a dash in a sentence a person reads: the house style has none (the em and en dash; a hyphen inside a word is fine)
const DASH = /[–—]|\s-\s/;

const words = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).length;

/** Each app's ops and their params, `{ app: { opId: [param, …] } }`. */
export function declaredOps(manifests = allManifests()) {
  const out = {};
  for (const m of manifests) {
    if (!m?.app) continue;
    out[m.app] ??= {};
    for (const op of m.operations ?? []) if (op?.id) out[m.app][op.id] = (op.params ?? []).map((p) => p?.name).filter(Boolean);
  }
  return out;
}


const BASELINE_REL = 'scripts/op-descriptions-baseline.json';
const READER = 'apps/basis/src/v2/opDescriptions.js';
const SHARED_LOCALE = (lang) => `apps/basis/src/locales/circle.${lang}.json`;
const FIX = '\n    Fix: ';
const RUN_UPDATE = `${FIX}run node scripts/lint-op-descriptions.mjs --update (it only removes entries).`;
const NO_DASH = `${FIX}rewrite it without the dash (an en or em dash, or a hyphen between spaces): a full stop, a comma or a colon instead.`;

/**
 * The descriptions file that sits beside a manifest file: `apps/<dir>/manifest.js` → `apps/<dir>/descriptions.<lang>.json`,
 * `<dir>/<name>.js` → `<dir>/<name>.descriptions.<lang>.json` (the manifests declared inside basis).
 */
export function descriptionsFile(manifestRel, lang) {
  if (/(^|\/)manifest\.js$/.test(manifestRel)) return manifestRel.replace(/manifest\.js$/, `descriptions.${lang}.json`);
  return manifestRel.replace(/\.js$/, `.descriptions.${lang}.json`);
}

/** Where an app's manifest and words live, from `{ app: manifestRel }` (`apps/<app>/manifest.js` when absent). */
function filesOf(manifestFiles, app) {
  const manifest = manifestFiles?.[app] ?? `apps/${app}/manifest.js`;
  const beside = manifest === MANIFEST_LIST ? `apps/${app}/manifest.js` : manifest;   // its own file not found: the usual place
  return { manifest, words: (lang) => descriptionsFile(beside, lang) };
}

/**
 * @param {{ declared: Record<string, Record<string, string[]>>, files: Record<string, Record<string, object>>, baseline: string[],
 *   manifestFiles?: Record<string, string> }} a
 *   files: `{ app: { en: {…}, nl: {…} } }` for the apps that have any file; manifestFiles: each app's manifest file
 * @returns {string[]} problems
 */
export function auditDescriptions({ declared, files, baseline, manifestFiles = {} }) {
  const problems = [];
  const owed = new Set(baseline);
  for (const app of Object.keys(declared)) {
    const at = filesOf(manifestFiles, app);
    if (!files[app]) {
      if (!owed.has(app)) problems.push(`${app} has no descriptions and is not in the baseline (no ${at.words('en')}, ${at.words('nl')} the reader imports).${FIX}add ${at.words('en')} and ${at.words('nl')}, a \`what\` per op and a phrase per param that ${at.manifest} declares, and import both in ${READER}.`);
      continue;
    }
    const ops = declared[app];
    for (const lang of LANGS) {
      const file = at.words(lang);
      const f = files[app][lang];
      if (!f) { problems.push(`${file}: ${app} has no descriptions.${lang}.json.${FIX}add it with the same ops as the other language's file, and import it in ${READER}.`); continue; }
      for (const [opId, params] of Object.entries(ops)) {
        const d = f[opId];
        if (typeof d?.what !== 'string' || !d.what.trim()) problems.push(`${file}: ${app}.${opId} has no \`what\` (${lang}).${FIX}add "${opId}": { "what": "<a sentence a person reads>" }, for the op ${at.manifest} declares.`);
        else {
          if (words(d.what) > MAX_WHAT) problems.push(`${file}: ${app}.${opId} \`what\` (${lang}) is ${words(d.what)} words; at most ${MAX_WHAT}.${FIX}shorten ${opId}.what to at most ${MAX_WHAT} words.`);
          if (DASH.test(d.what)) problems.push(`${file}: ${app}.${opId} \`what\` (${lang}) has a dash.${NO_DASH}`);
        }
        for (const p of params) {
          const phrase = d?.params?.[p];
          if (typeof phrase !== 'string' || !phrase.trim()) { problems.push(`${file}: ${app}.${opId} param \`${p}\` has no phrase (${lang}).${FIX}add "${p}": "<a short phrase>" under ${opId}.params, for the param ${at.manifest} declares on the op.`); continue; }
          if (words(phrase) > MAX_PHRASE) problems.push(`${file}: ${app}.${opId} param \`${p}\` (${lang}) is ${words(phrase)} words; at most ${MAX_PHRASE}.${FIX}shorten ${opId}.params.${p} to at most ${MAX_PHRASE} words.`);
          if (DASH.test(phrase)) problems.push(`${file}: ${app}.${opId} param \`${p}\` (${lang}) has a dash.${NO_DASH}`);
        }
      }
      for (const [opId, d] of Object.entries(f)) {
        if (!(opId in ops)) { problems.push(`${file}: ${app}.${opId} (${lang}) describes an op no manifest declares.${FIX}remove the entry, or correct the op id to the one ${at.manifest} declares.`); continue; }
        for (const p of Object.keys(d?.params ?? {})) if (!ops[opId].includes(p)) problems.push(`${file}: ${app}.${opId} param \`${p}\` (${lang}) describes a param the op does not declare.${FIX}remove the phrase, or correct the name to the param the op declares in ${at.manifest}.`);
      }
    }
  }
  for (const app of owed) {
    if (!(app in declared)) problems.push(`${BASELINE_REL}: baseline lists ${app}, which no manifest declares any more.${RUN_UPDATE}`);
    else if (files[app]) problems.push(`${BASELINE_REL}: baseline lists ${app}, which now has its descriptions.${RUN_UPDATE}`);
  }
  return problems;
}

/** The red line for a words file on disk that the reader does not import. */
export function unreadMessage(f) {
  return `${f}: on disk, but the reader (${READER}) does not import it: words nobody reads.${FIX}import it in ${READER} and add it to OP_DESCRIPTIONS, or delete the file.`;
}

// an app folder whose name is not its app id
const APP_OF_DIR = { 'tasks-v0': 'tasks' };

/**
 * The descriptions files on disk that the reader does not import: words nobody reads (red). `paths` are repo-relative
 * `apps/<dir>/descriptions.<lang>.json`; `registry` is the reader's `{ app: { lang: … } }`.
 * @returns {string[]}
 */
export function unreadFiles(paths, registry) {
  return paths.filter((p) => {
    const m = /^apps\/([^/]+)\/descriptions\.([a-z]+)\.json$/.exec(p);
    if (!m) return false;
    const app = APP_OF_DIR[m[1]] ?? m[1];
    return !registry?.[app]?.[m[2]];
  });
}


/**
 * GENERIC OPS (a noun with the generic verbs, no op of its own): the verb is described once, in the locale beside its
 * label (`circle.settings.verb_what.<atom>`, read through `genericVerbWords`), the noun by its manifest's own names. Red when a verb some named noun uses has
 * no sentence in a language; a generic noun not owed has no names {one, other} in a language; an owed noun now has its
 * names, or is no generic noun any more (the owed list only shrinks).
 * @param {{ generic: Array<{app: string, noun: string, atoms: string[]}>, atomWords: Record<string, Record<string, {what?: string}>>,
 *   names: Record<string, Record<string, {one?: string, other?: string}>>, owed: string[] }} a
 * @returns {string[]}
 */
export function auditGeneric({ generic, atomWords, names, owed, manifestFiles = {} }) {
  const problems = [];
  const owedSet = new Set(owed);
  const named = (key, lang) => Boolean(names[key]?.[lang]?.one && names[key]?.[lang]?.other);
  const keys = new Set();
  for (const g of generic) {
    const key = `${g.app}.${g.noun}`;
    keys.add(key);
    if (owedSet.has(key)) continue;
    for (const lang of LANGS) {
      if (!named(key, lang)) problems.push(`${filesOf(manifestFiles, g.app).manifest}: ${key} has no names (${lang}).${FIX}its manifest's nouns.${g.noun}.names needs {one, other}: add nouns.${g.noun}.names.${lang} = { one, other }.`);
      for (const atom of g.atoms) {
        const what = atomWords[lang]?.[atom]?.what;
        if (typeof what !== 'string' || !what.trim()) problems.push(`${SHARED_LOCALE(lang)}: the generic verb \`${atom}\` has no sentence (${lang}), and ${key} uses it.${FIX}add settings.verb_what.${atom} in ${SHARED_LOCALE(lang)}.`);
        else if (DASH.test(what)) problems.push(`${SHARED_LOCALE(lang)}: the generic verb \`${atom}\` (${lang}) has a dash.${NO_DASH}`);
      }
    }
  }
  for (const key of owedSet) {
    if (!keys.has(key)) problems.push(`${BASELINE_REL}: baseline owes ${key}, which is no generic noun any more.${RUN_UPDATE}`);
    else if (LANGS.every((l) => named(key, l))) problems.push(`${BASELINE_REL}: baseline owes ${key}, which now has its words.${RUN_UPDATE}`);
  }
  return [...new Set(problems)];
}

/**
 * The bot's help phrases (`circle.bot.help.ops.<app>.<opId>`) are a SECOND home for what an op does in a person's words
 * (ledger L1033). Until Frits chooses the word and they move into the descriptions, the home is FROZEN: no key beyond the
 * frozen list, and every key names an op that has a description (so the move has somewhere to land). The list only
 * shrinks (`--update` drops a key that is gone).
 * @param {{ keys: string[], frozen: string[], describe: (app: string, opId: string) => unknown }} a
 *   keys: `<app>.<opId>` per help phrase, over every locale
 * @returns {string[]} problems
 */
export function auditHelpPhrases({ keys, frozen, describe, manifestFiles = {} }) {
  const problems = [];
  const held = new Set(frozen);
  const LOCALES = SHARED_LOCALE(`{${LANGS.join(',')}}`);
  for (const k of new Set(keys)) {
    const dot = k.indexOf('.');
    const app = k.slice(0, dot), opId = k.slice(dot + 1);
    const wordsFile = filesOf(manifestFiles, app).words('en');
    if (!held.has(k)) problems.push(`${LOCALES}: circle.bot.help.ops.${k} is a NEW help phrase.${FIX}what an op does goes in its descriptions file (L1033), not here: remove bot.help.ops.${k} and put the words in ${wordsFile} as ${opId}.what.`);
    if (!describe(app, opId)) problems.push(`${LOCALES}: circle.bot.help.ops.${k} names an op with no description.${FIX}describe ${app}.${opId} first, in ${wordsFile} (and its nl twin).`);
  }
  const present = new Set(keys);
  for (const k of held) if (!present.has(k)) problems.push(`${BASELINE_REL}: the frozen help list holds ${k}, which no locale has any more.${RUN_UPDATE}`);
  return problems;
}

/** `<app>.<opId>` for every help phrase in a locale bundle's `bot.help.ops`. */
export function helpPhraseKeys(bundle) {
  const ops = bundle?.bot?.help?.ops ?? {};
  return Object.entries(ops).flatMap(([app, byOp]) => Object.keys(byOp ?? {}).map((op) => `${app}.${op}`));
}

/**
 * The words files that sit BESIDE a manifest inside basis (`apps/basis/src/v2/<manifest>.descriptions.<lang>.json`,
 * several manifests share that folder) that the reader does not import: words nobody reads (red). Read by name off the
 * reader's own source, since the folder does not say which app a file is.
 * @param {string[]} paths  repo-relative paths  @param {string} readerSource  opDescriptions.js's text
 * @returns {string[]}
 */
export function unreadBesideFiles(paths, readerSource) {
  return paths.filter((p) => /\.descriptions\.[a-z]+\.json$/.test(p) && !String(readerSource).includes(`./${path.basename(p)}'`));
}

/** What `--update` writes: the baseline with described or gone apps REMOVED; never an app added. */
export function shrunkBaseline({ declared, files, baseline }) {
  return [...new Set(baseline)].filter((app) => app in declared && !files[app]).sort();
}


/** `<app>.<opId>` of every help phrase in the shared locale, both languages. */
function helpKeysNow() {
  const root = path.resolve(HERE, '..');
  return LANGS.flatMap((l) => helpPhraseKeys(JSON.parse(readFileSync(path.join(root, `apps/basis/src/locales/circle.${l}.json`), 'utf8'))));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const declared = declaredOps();
  const files = OP_DESCRIPTIONS;
  const before = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).owed ?? [] : [];
  if (process.argv.includes('--update')) {
    const owed = shrunkBaseline({ declared, files, baseline: before });
    const prev = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).nounsOwed ?? [] : [];
    const { generic, names } = genericNouns();
    const isGeneric = new Set(generic.map((g) => `${g.app}.${g.noun}`));
    const nounsOwed = prev.filter((k) => isGeneric.has(k) && !LANGS.every((l) => names[k]?.[l]?.one && names[k]?.[l]?.other)).sort();
    const stored = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
    const helpPhrases = (stored.helpPhrases ?? []).filter((k) => helpKeysNow().includes(k));
    writeFileSync(BASELINE, `${JSON.stringify({ owed, nounsOwed, helpPhrases }, null, 2)}\n`);
    console.log(`lint-op-descriptions: baseline shrunk ${before.length} → ${owed.length} (it never grows: a new app ships its words)`);
    process.exit(0);
  }
  const ROOT = path.resolve(HERE, '..');
  const onDisk = readdirSync(path.join(ROOT, 'apps'), { withFileTypes: true }).filter((d) => d.isDirectory())
    .flatMap((d) => readdirSync(path.join(ROOT, 'apps', d.name)).filter((f) => /^descriptions\.[a-z]+\.json$/.test(f)).map((f) => `apps/${d.name}/${f}`));
  const beside = readdirSync(path.join(ROOT, 'apps/basis/src/v2')).filter((f) => /\.descriptions\.[a-z]+\.json$/.test(f)).map((f) => `apps/basis/src/v2/${f}`);
  const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};
  const { generic, names } = genericNouns();
  const manifestFiles = await manifestFileByApp(allManifests());
  const problems = [
    ...auditDescriptions({ declared, files, baseline: before, manifestFiles }),
    ...auditGeneric({ generic, atomWords: Object.fromEntries(LANGS.map((l) => [l, genericVerbWords(l)])), names, owed: base.nounsOwed ?? [], manifestFiles }),
    ...auditHelpPhrases({ keys: helpKeysNow(), frozen: base.helpPhrases ?? [], describe: (app, opId) => opDescription(app, opId, 'en'), manifestFiles }),
    ...unreadFiles(onDisk, files).map(unreadMessage),
    ...unreadBesideFiles(beside, readFileSync(path.join(ROOT, READER), 'utf8')).map(unreadMessage),
  ];
  if (problems.length) {
    console.error(`✖ lint-op-descriptions: ${problems.length} problem(s)`);
    for (const p of problems.slice(0, 40)) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`✓ lint-op-descriptions: ${Object.keys(files).length} app(s) described, ${before.length} owed their words (baseline)`);
}
