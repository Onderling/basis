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
import { externalOrigins, PLACED_HOSTS } from '../apps/basis/src/core/agent/egressGate.js';
import { manifestFileByApp } from './guard-where.mjs';

const CLASSIFY = 'classify this verb: read or write';

/**
 * Audit one manifest. Returns the list of problems (empty = green).
 * @param {object} manifest
 * @returns {{ opId: string|null, message: string }[]}
 */
/**
 * The agreement that makes '@placed' honest: the apps that declare it are exactly the apps the egress gate treats as
 * reaching outside. Red either way (a declaration the gate ignores, or a gate list the manifests do not say).
 * @param {object[]} manifests @param {Set<string>} gateExternal
 * @returns {string[]} problems
 */
export function auditPlacedAgreement(manifests, gateExternal, files = {}) {
  const declared = new Set((manifests ?? []).filter((m) => Array.isArray(m?.hosts) && m.hosts.includes(PLACED_HOSTS)).map((m) => m.app));
  const problems = [];
  for (const app of declared) if (!gateExternal.has(app)) problems.push(`${fileOf(files, app)}: ${app} declares '${PLACED_HOSTS}' but the egress gate (${EGRESS_GATE}) does not treat it as reaching outside.\n    Fix: remove '${PLACED_HOSTS}' from its \`hosts\` if it reaches nothing outside, or make the egress gate read this manifest.`);
  for (const app of gateExternal) if (!declared.has(app)) problems.push(`${fileOf(files, app)}: the egress gate (${EGRESS_GATE}) treats ${app} as reaching outside but its manifest does not declare '${PLACED_HOSTS}'.\n    Fix: add '${PLACED_HOSTS}' to its \`hosts\`, or take it off the egress gate's list.`);
  return problems;
}

const EGRESS_GATE = 'apps/basis/src/core/agent/egressGate.js';
const FIX = '\n    Fix: ';
/** An app's manifest file from the map, `apps/<app>/manifest.js` when the map has none. */
const fileOf = (files, app) => files?.[app] ?? `apps/${app}/manifest.js`;

/** One red line: the manifest file, the app (and op), and the problem with its Fix line. */
export function redLine({ file, app, opId, message }) {
  return `${file}: ${app}${opId ? `.${opId}` : ''}: ${message}`;
}

export function auditManifest(manifest) {
  const problems = [];
  if (!Array.isArray(manifest?.hosts)) {
    problems.push({ opId: null, message: `no \`hosts\` array.${FIX}declare the network hosts this app reaches at the manifest's top level (\`hosts: []\` for none).` });
  } else {
    manifest.hosts.forEach((h, i) => {
      if (typeof h !== 'string' || h.trim() === '') {
        problems.push({ opId: null, message: `hosts[${i}] must be a non-empty host name (got ${JSON.stringify(h)}).${FIX}write the host name there, or remove the entry.` });
      } else if (h.startsWith('@') && h !== PLACED_HOSTS) {
        // one reserved word only: '@placed' (the hosts a box's operator places); any other '@' word is no host and no claim
        problems.push({ opId: null, message: `hosts[${i}] '${h}' is not a host; the only reserved word is '${PLACED_HOSTS}'.${FIX}write the host name, or '${PLACED_HOSTS}' for the hosts a box's operator places.` });
      }
    });
  }
  if (Array.isArray(manifest?.domainVerbs)) {
    problems.push({ opId: null, message: `\`domainVerbs\` is a list.${FIX}make it a map and ${CLASSIFY} ({ verb: 'read' | 'write' }).` });
  }
  for (const op of manifest?.operations ?? []) {
    const id = op?.id ?? '(no id)';
    const kind = verbKind(manifest, op?.verb);
    if (kind === null) {
      problems.push({ opId: id, message: `domain verb '${op.verb}' is not in the \`domainVerbs\` map.${FIX}${CLASSIFY}: add ${op.verb}: 'read' or 'write' to the manifest's \`domainVerbs\`.` });
      continue;
    }
    if (op?.writes !== undefined) {
      const scope = op.writes?.scope;
      if (!op.writes || typeof op.writes !== 'object' || !WRITE_SCOPES.includes(scope)) {
        problems.push({ opId: id, message: `writes.scope must be one of ${WRITE_SCOPES.join(' | ')} (got ${JSON.stringify(op.writes)}).${FIX}set writes: { scope: ${WRITE_SCOPES.map((s) => `'${s}'`).join(' | ')} } on the op, the widest place it writes.` });
      }
    } else if (kind === 'write' || op?.appends !== undefined) {
      const why = op?.appends !== undefined ? 'appends' : (op?.verb ? `verb '${op.verb}'` : 'no verb');
      problems.push({ opId: id, message: `writing op (${why}) has no \`writes: { scope }\` declaration.${FIX}add writes: { scope: ${WRITE_SCOPES.map((s) => `'${s}'`).join(' | ')} } to the op, the widest place it writes.` });
    }
  }
  return problems;
}

const BASELINE_REL = 'scripts/manifest-what-baseline.json';
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
      if (what === undefined) owed.push({ opId: id, kind: 'what', message: `a writing op with no writes.what.${FIX}declare what it writes: writes.what = ${WRITE_WHATS.join(' | ')}.` });
      else if (!WRITE_WHATS.includes(what)) owed.push({ opId: id, kind: 'bad', message: `writes.what must be one of ${WRITE_WHATS.join(' | ')} (got ${JSON.stringify(what)}).${FIX}set writes.what to one of ${WRITE_WHATS.join(' | ')}.` });
    }
    if (op?.reveals !== undefined && !REVEALS.includes(op.reveals)) {
      owed.push({ opId: id, kind: 'bad', message: `reveals must be one of ${REVEALS.join(' | ')} (got ${JSON.stringify(op.reveals)}).${FIX}set reveals to one of ${REVEALS.join(' | ')}.` });
    } else if (op?.reveals === undefined && op?.writes === undefined && op?.group === 'device' && verbKind(manifest, op?.verb) === 'read') {
      owed.push({ opId: id, kind: 'reveals', message: `a read in the device group with no \`reveals\`.${FIX}a read in the device group says what it hands out: reveals = ${REVEALS.join(' | ')}.` });
    }
  }
  return owed;
}

/**
 * The verdict against the baseline: the lines that are red. Owed and baselined is quiet (debt, visible); owed and not
 * baselined is red; a bad word is red; a baseline entry that is no longer owed (filled in, or the op gone) is red until
 * `--update` removes it.
 * @param {{ owed: {app: string, opId: string, kind: string, message?: string}[], baseline: {what?: string[], reveals?: string[]},
 *   files?: Record<string, string> }} a  files: each app's manifest file (repo-relative)
 * @returns {string[]}
 */
export function judgeWhat({ owed, baseline, files = {} }) {
  const red = [];
  const held = { what: new Set(baseline?.what ?? []), reveals: new Set(baseline?.reveals ?? []) };
  const now = { what: new Set(), reveals: new Set() };
  for (const o of owed) {
    const key = `${o.app}.${o.opId}`;
    const line = (message) => redLine({ file: fileOf(files, o.app), app: o.app, opId: o.opId, message });
    if (o.kind === 'bad') { red.push(line(o.message ?? 'unknown word')); continue; }
    now[o.kind].add(key);
    if (!held[o.kind].has(key)) red.push(line(o.message ?? `owes ${o.kind}`));
  }
  for (const kind of ['what', 'reveals']) {
    for (const key of held[kind]) if (!now[kind].has(key)) red.push(`${BASELINE_REL}: baseline ${key}: no longer owes ${kind}.${FIX}run node scripts/lint-manifest-scopes.mjs --update (it only removes entries).`);
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
  const files = await manifestFileByApp(manifests.map((m) => m.manifest));
  let opCount = 0;
  const redManifests = new Set();
  for (const { app, manifest } of manifests) {
    for (const p of auditManifest(manifest)) {
      redManifests.add(app);
      if (p.opId) opCount += 1;
      console.error(`  ${redLine({ file: fileOf(files, app), app, ...p })}`);
    }
  }
  const agreement = auditPlacedAgreement(manifests.map((m) => m.manifest), externalOrigins(manifests.map((m) => m.manifest)), files);
  for (const p of agreement) console.error(`  ${p}`);
  const owed = manifests.flatMap(({ app, manifest }) => auditWhat(manifest).map((o) => ({ app, ...o })));
  const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : { what: [], reveals: [] };
  if (process.argv.includes('--update')) {
    const next = shrunkWhatBaseline({ owed, baseline });
    writeFileSync(BASELINE, `${JSON.stringify({ ...baseline, ...next }, null, 2)}\n`);
    console.log(`lint-manifest-scopes: baseline shrunk what ${(baseline.what ?? []).length} → ${next.what.length}, reveals ${(baseline.reveals ?? []).length} → ${next.reveals.length} (it never grows)`);
    return;
  }
  const redWhat = judgeWhat({ owed, baseline, files });
  for (const line of redWhat) console.error(`  ${line}`);
  if (redManifests.size || agreement.length || redWhat.length) {
    console.error(`lint-manifest-scopes: ${opCount} op problem(s) in ${redManifests.size} of ${manifests.length} manifest(s); ${agreement.length} '${PLACED_HOSTS}' disagreement(s); ${redWhat.length} weight problem(s)`);
    process.exit(1);
  }
  console.log(`lint-manifest-scopes: ${manifests.length} manifests — every writing op declares where it writes, every manifest its hosts; ${owed.filter((o) => o.kind !== 'bad').length} weight declarations still owed (baseline)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
