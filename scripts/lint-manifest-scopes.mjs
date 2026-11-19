#!/usr/bin/env node
/**
 * lint-manifest-scopes — every writing op declares where it writes; every manifest, the hosts it reaches.
 *
 * Two declarations, both on the manifest (the single contract), both read by nothing yet at runtime —
 * which is exactly why they need a guard: a declaration nobody checks drifts the first time someone adds
 * an op and forgets it.
 *
 *   • `writes: { scope: 'device' | 'person' | 'circle' }` on an op row. Required on every op that is not
 *     known to only read: its verb is a writing atom (every atom except `list`/`get`), a domain verb its
 *     manifest classifies `'write'`, or no verb at all; or it declares `appends`. The manifest classifies
 *     each domain verb in its `domainVerbs` map (`{ verb: 'read' | 'write' }`); a domain verb missing from
 *     the map — or a `domainVerbs` that is still a plain list — is red, "classify this verb: read or write".
 *     The default is the safe one: a verb nobody classified never passes as a silent read. (`verbKind` in
 *     `@onderling/app-manifest` is the one reading of this.)
 *       device — only on this device (local settings, caches, this device's registrations);
 *       person — the person's own data, following them across their devices;
 *       circle — the circle's shared store or log, which syncs to the circle's members.
 *     An op that writes in more than one place declares the WIDEST of them. The key is `writes`, not
 *     `scope`: `scope` already means "who a setting applies to" on settings and param rows.
 *   • `writes.what` beside the scope: WHAT it writes (`content | preference | control | keys`), and `reveals`
 *     (`keys | none`) on every read in `group: 'device'` (L977: an op's weight, `opWeight` in
 *     `@onderling/app-manifest`, follows from these). The ops that owe one today are the baseline
 *     (`manifest-what-baseline.json`), which may only shrink (`--update` only removes); an unknown word is red at once.
 *   • `hosts: string[]` at the manifest's top level — every host the app's code reaches over the
 *     network. An empty list is a claim ("none"), a missing one is no claim at all.
 *
 * WHICH manifests: every manifest the app runs, read from the one list the shells compose from
 * (`apps/basis/src/v2/manifestSources.js`) — the app manifests AND the plumbing ones declared elsewhere
 * (the parameter register, the device-log lanes). Not a glob: a glob misses a manifest declared outside
 * `apps/<app>/manifest.js`, and nobody would see the hole.
 *
 * Pure core (`auditManifest`) + a thin CLI, so the self-test can drive it with synthetic manifests.
 */
import path from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { verbKind, WRITE_SCOPES, WRITE_WHATS, REVEALS } from '../packages/app-manifest/src/atoms.js';
import { allManifests } from '../apps/basis/src/v2/manifestSources.js';

const CLASSIFY = 'classify this verb: read or write';

/**
 * Audit one manifest. Returns the list of problems (empty = green).
 * @param {object} manifest
 * @returns {{ opId: string|null, message: string }[]}
 */
export function auditManifest(manifest) {
  const problems = [];
  if (!Array.isArray(manifest?.hosts)) {
    problems.push({ opId: null, message: 'no `hosts` array — declare the network hosts this app reaches (`hosts: []` for none)' });
  } else {
    manifest.hosts.forEach((h, i) => {
      if (typeof h !== 'string' || h.trim() === '') {
        problems.push({ opId: null, message: `hosts[${i}] must be a non-empty host name (got ${JSON.stringify(h)})` });
      }
    });
  }
  if (Array.isArray(manifest?.domainVerbs)) {
    problems.push({ opId: null, message: `\`domainVerbs\` is a list — make it a map and ${CLASSIFY} ({ verb: 'read' | 'write' })` });
  }
  for (const op of manifest?.operations ?? []) {
    const id = op?.id ?? '(no id)';
    const kind = verbKind(manifest, op?.verb);
    if (kind === null) {
      problems.push({ opId: id, message: `domain verb '${op.verb}' is not in the \`domainVerbs\` map — ${CLASSIFY}` });
      continue;
    }
    if (op?.writes !== undefined) {
      const scope = op.writes?.scope;
      if (!op.writes || typeof op.writes !== 'object' || !WRITE_SCOPES.includes(scope)) {
        problems.push({ opId: id, message: `writes.scope must be one of ${WRITE_SCOPES.join(' | ')} (got ${JSON.stringify(op.writes)})` });
      }
    } else if (kind === 'write' || op?.appends !== undefined) {
      const why = op?.appends !== undefined ? 'appends' : (op?.verb ? `verb '${op.verb}'` : 'no verb');
      problems.push({ opId: id, message: `writing op (${why}) has no \`writes: { scope }\` declaration` });
    }
  }
  return problems;
}

const BASELINE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'manifest-what-baseline.json');

/**
 * What one manifest owes for its weight (L977): a writing op without `writes.what` (`what`), a device read without
 * `reveals` (`reveals`), and an unknown word in either (`bad`: red at once, never baselined).
 * @param {object} manifest
 * @returns {{ opId: string, kind: 'what'|'reveals'|'bad', message: string }[]}
 */
export function auditWhat(manifest) {
  const owed = [];
  for (const op of manifest?.operations ?? []) {
    const id = op?.id ?? '(no id)';
    if (op?.writes && typeof op.writes === 'object') {
      const what = op.writes.what;
      if (what === undefined) owed.push({ opId: id, kind: 'what', message: `declare what it writes: writes.what = ${WRITE_WHATS.join(' | ')}` });
      else if (!WRITE_WHATS.includes(what)) owed.push({ opId: id, kind: 'bad', message: `writes.what must be one of ${WRITE_WHATS.join(' | ')} (got ${JSON.stringify(what)})` });
    }
    if (op?.reveals !== undefined && !REVEALS.includes(op.reveals)) {
      owed.push({ opId: id, kind: 'bad', message: `reveals must be one of ${REVEALS.join(' | ')} (got ${JSON.stringify(op.reveals)})` });
    } else if (op?.reveals === undefined && op?.writes === undefined && op?.group === 'device' && verbKind(manifest, op?.verb) === 'read') {
      owed.push({ opId: id, kind: 'reveals', message: `a read in the device group says what it hands out: reveals = ${REVEALS.join(' | ')}` });
    }
  }
  return owed;
}

/**
 * The verdict against the baseline: the lines that are red. Owed and baselined is quiet (debt, visible); owed and not
 * baselined is red; a bad word is red; a baseline entry that is no longer owed (filled in, or the op gone) is red until
 * `--update` removes it.
 * @param {{ owed: {app: string, opId: string, kind: string, message?: string}[], baseline: {what?: string[], reveals?: string[]} }} a
 * @returns {string[]}
 */
export function judgeWhat({ owed, baseline }) {
  const red = [];
  const held = { what: new Set(baseline?.what ?? []), reveals: new Set(baseline?.reveals ?? []) };
  const now = { what: new Set(), reveals: new Set() };
  for (const o of owed) {
    const key = `${o.app}.${o.opId}`;
    if (o.kind === 'bad') { red.push(`${key}: ${o.message ?? 'unknown word'}`); continue; }
    now[o.kind].add(key);
    if (!held[o.kind].has(key)) red.push(`${key}: ${o.message ?? `owes ${o.kind}`}`);
  }
  for (const kind of ['what', 'reveals']) {
    for (const key of held[kind]) if (!now[kind].has(key)) red.push(`baseline ${key}: no longer owes ${kind} — run with --update`);
  }
  return red;
}

/** What `--update` writes: the baseline with what is no longer owed REMOVED. It never adds. */
export function shrunkWhatBaseline({ owed, baseline }) {
  const out = {};
  for (const kind of ['what', 'reveals']) {
    const now = new Set(owed.filter((o) => o.kind === kind).map((o) => `${o.app}.${o.opId}`));
    out[kind] = [...new Set(baseline?.[kind] ?? [])].filter((k) => now.has(k)).sort();
  }
  return out;
}

/** Every manifest the app runs: `{ app, manifest }`. */
export async function loadManifests() {
  return allManifests().map((manifest) => ({ app: manifest.app, manifest }));
}

async function main() {
  const manifests = await loadManifests();
  let opCount = 0;
  const redManifests = new Set();
  for (const { app, manifest } of manifests) {
    for (const p of auditManifest(manifest)) {
      redManifests.add(app);
      if (p.opId) opCount += 1;
      console.error(`  ${app}${p.opId ? `.${p.opId}` : ''}: ${p.message}`);
    }
  }
  const owed = manifests.flatMap(({ app, manifest }) => auditWhat(manifest).map((o) => ({ app, ...o })));
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { what: [], reveals: [] };
  if (process.argv.includes('--update')) {
    const next = shrunkWhatBaseline({ owed, baseline });
    writeFileSync(BASELINE, `${JSON.stringify({ ...baseline, ...next }, null, 2)}\n`);
    console.log(`lint-manifest-scopes: baseline shrunk what ${(baseline.what ?? []).length} → ${next.what.length}, reveals ${(baseline.reveals ?? []).length} → ${next.reveals.length} (it never grows)`);
    return;
  }
  const redWhat = judgeWhat({ owed, baseline });
  for (const line of redWhat) console.error(`  ${line}`);
  if (redManifests.size || redWhat.length) {
    console.error(`lint-manifest-scopes: ${opCount} op problem(s) in ${redManifests.size} of ${manifests.length} manifest(s); ${redWhat.length} weight problem(s)`);
    process.exit(1);
  }
  console.log(`lint-manifest-scopes: ${manifests.length} manifests — every writing op declares where it writes, every manifest its hosts; ${owed.filter((o) => o.kind !== 'bad').length} weight declarations still owed (baseline)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
