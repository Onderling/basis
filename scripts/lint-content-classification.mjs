#!/usr/bin/env node
/**
 * lint-content-classification — every durable STORE a shell builds is classified in `enrolForgets.js`.
 *
 * A freshly enrolled device forgets what its throwaway self wrote, and the list of what that means lives in one
 * place: the storage register's `forget` column (`enrolForgets.js` derives its lists from it). The list is the whole deliverable: the shells never had one, which is why they never swept, and a list
 * assembled by reading the code rots the first time someone adds a store — silently, because nothing fails when
 * a store is merely forgotten. This is the something that fails.
 *
 * SCOPE, on purpose: STORES, not keys. A store is a whole namespace (an IndexedDB database, an AsyncStorage
 * scope, a file on the box) built at a call site with a recognisable shape, and a new one is exactly the thing
 * that would be missed. Flat keys are added constantly for view state and preferences; guarding those would cry
 * wolf until someone switched it off, which is worse than not guarding them. The keys are classified by hand in
 * `enrolForgets.js` and reviewed with the table.
 *
 * A store may be classified either way — content or kept. What it may not be is unsaid.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
/**
 * Comments come out BEFORE anything is parsed. This file's prose is full of apostrophes — "web's",
 * "the person's content" — and every one of them opens a string literal to a naive scan, so the first version
 * of this guard read a list of fragments and reported three stores missing that were sitting right there.
 * A guard that mis-parses in silence is worse than no guard.
 */
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const read = (p) => { try { return strip(readFileSync(path.join(ROOT, p), 'utf8')); } catch { return ''; } };

/** Where a shell names a durable store, and how. Template literals (`cc-circle-${id}`) are the per-circle family. */
const SITES = [
  { file: 'apps/basis/web/v2/circleApp.js', patterns: [/pickWebBackend\(\s*'([^']+)'/g, /dbName:\s*'([^']+)'/g] },
  { file: 'apps/basis-mobile/App.js', patterns: [/scope:\s*'([^']+)'/g] },
  { file: 'apps/basis-mobile/src/core/agentBundle.js', patterns: [/scope:\s*'([^']+)'/g] },
];

/** Scopes that are not durable stores: an in-memory partition name, a sync selector, a vault prefix. */
const NOT_A_STORE = new Set(['all', 'self', 'circle', 'items', 'outbox']);

// The classification is the storage register's `forget` column: a row ruled `throwaway` or `keep` is said; an
// `undecided` row is not, so a shell that builds one is red here until it is ruled.
const { STORAGE } = await import(path.join(ROOT, 'apps/basis/src/v2/storageRegister.js'));
const classified = new Set(Object.values(STORAGE).filter((r) => r.forget !== 'undecided').map((r) => r.name));

const unsaid = [];
for (const site of SITES) {
  const text = read(site.file);
  for (const re of site.patterns) {
    for (const m of text.matchAll(re)) {
      const name = m[1];
      if (NOT_A_STORE.has(name) || classified.has(name)) continue;
      // The per-circle family is resolved at run time from the registry, not named one by one.
      if (/^cc-circle(-cache)?-/.test(name)) continue;
      unsaid.push({ name, file: site.file });
    }
  }
}

if (unsaid.length) {
  console.error(`\n✖ lint-content-classification: ${unsaid.length} durable store(s) a shell builds but the storage register does not classify:`);
  for (const u of unsaid) console.error(`   • '${u.name}'  — built in ${u.file}`);
  console.error('\nA freshly enrolled device must know whether each of these is the THROWAWAY self\'s content or this');
  console.error('device\'s own. Give it a row in src/v2/storageRegister.js with `forget: throwaway` (it goes) or `keep` (it stays) —');
  console.error('and say why in a comment, because the next reader has to be able to check your answer.\n');
  process.exit(1);
}
console.log(`lint-content-classification: every durable store a shell builds is classified (${classified.size} names on the list).`);
