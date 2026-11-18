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
import { OP_DESCRIPTIONS } from '../apps/basis/src/v2/opDescriptions.js';

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


/**
 * @param {{ declared: Record<string, Record<string, string[]>>, files: Record<string, Record<string, object>>, baseline: string[] }} a
 *   files: `{ app: { en: {…}, nl: {…} } }` for the apps that have any file
 * @returns {string[]} problems
 */
export function auditDescriptions({ declared, files, baseline }) {
  const problems = [];
  const owed = new Set(baseline);
  for (const app of Object.keys(declared)) {
    if (!files[app]) { if (!owed.has(app)) problems.push(`${app} has no descriptions and is not in the baseline (add apps/<app>/descriptions.{en,nl}.json)`); continue; }
    const ops = declared[app];
    for (const lang of LANGS) {
      const f = files[app][lang];
      if (!f) { problems.push(`${app} has no descriptions.${lang}.json`); continue; }
      for (const [opId, params] of Object.entries(ops)) {
        const d = f[opId];
        if (typeof d?.what !== 'string' || !d.what.trim()) problems.push(`${app}.${opId} has no \`what\` (${lang})`);
        else {
          if (words(d.what) > MAX_WHAT) problems.push(`${app}.${opId} \`what\` (${lang}) is ${words(d.what)} words; at most ${MAX_WHAT}`);
          if (DASH.test(d.what)) problems.push(`${app}.${opId} \`what\` (${lang}) has a dash`);
        }
        for (const p of params) {
          const phrase = d?.params?.[p];
          if (typeof phrase !== 'string' || !phrase.trim()) { problems.push(`${app}.${opId} param \`${p}\` has no phrase (${lang})`); continue; }
          if (words(phrase) > MAX_PHRASE) problems.push(`${app}.${opId} param \`${p}\` (${lang}) is ${words(phrase)} words; at most ${MAX_PHRASE}`);
          if (DASH.test(phrase)) problems.push(`${app}.${opId} param \`${p}\` (${lang}) has a dash`);
        }
      }
      for (const [opId, d] of Object.entries(f)) {
        if (!(opId in ops)) { problems.push(`${app}.${opId} (${lang}) describes an op no manifest declares`); continue; }
        for (const p of Object.keys(d?.params ?? {})) if (!ops[opId].includes(p)) problems.push(`${app}.${opId} param \`${p}\` (${lang}) describes a param the op does not declare`);
      }
    }
  }
  for (const app of owed) {
    if (!(app in declared)) problems.push(`baseline lists ${app}, which no manifest declares any more: run with --update`);
    else if (files[app]) problems.push(`baseline lists ${app}, which now has its descriptions: run with --update`);
  }
  return problems;
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

/** What `--update` writes: the baseline with described or gone apps REMOVED; never an app added. */
export function shrunkBaseline({ declared, files, baseline }) {
  return [...new Set(baseline)].filter((app) => app in declared && !files[app]).sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const declared = declaredOps();
  const files = OP_DESCRIPTIONS;
  const before = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')).owed ?? [] : [];
  if (process.argv.includes('--update')) {
    const owed = shrunkBaseline({ declared, files, baseline: before });
    writeFileSync(BASELINE, `${JSON.stringify({ owed }, null, 2)}\n`);
    console.log(`lint-op-descriptions: baseline shrunk ${before.length} → ${owed.length} (it never grows: a new app ships its words)`);
    process.exit(0);
  }
  const ROOT = path.resolve(HERE, '..');
  const onDisk = readdirSync(path.join(ROOT, 'apps'), { withFileTypes: true }).filter((d) => d.isDirectory())
    .flatMap((d) => readdirSync(path.join(ROOT, 'apps', d.name)).filter((f) => /^descriptions\.[a-z]+\.json$/.test(f)).map((f) => `apps/${d.name}/${f}`));
  const problems = [
    ...auditDescriptions({ declared, files, baseline: before }),
    ...unreadFiles(onDisk, files).map((f) => `${f} is on disk but the reader (apps/basis/src/v2/opDescriptions.js) does not import it: words nobody reads`),
  ];
  if (problems.length) {
    console.error(`✖ lint-op-descriptions: ${problems.length} problem(s)`);
    for (const p of problems.slice(0, 40)) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log(`✓ lint-op-descriptions: ${Object.keys(files).length} app(s) described, ${before.length} owed their words (baseline)`);
}
