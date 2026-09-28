#!/usr/bin/env node
/**
 * lint-manifest-scopes — every writing op declares where it writes; every manifest, the hosts it reaches.
 *
 * Two declarations, both on the manifest (the single contract), both read by nothing yet at runtime —
 * which is exactly why they need a guard: a declaration nobody checks drifts the first time someone adds
 * an op and forgets it.
 *
 *   • `writes: { scope: 'device' | 'person' | 'circle' }` on an op row. Required when the op writes:
 *     its verb is a writing atom (every atom except the read ones — `isWritingVerb` in
 *     `@onderling/app-manifest`), or it declares `appends`. A domain verb the atom catalogue cannot
 *     classify may declare `writes` too; when it does, the value is checked like any other.
 *       device — only on this device (local settings, caches, this device's registrations);
 *       person — the person's own data, following them across their devices;
 *       circle — the circle's shared store or log, which syncs to the circle's members.
 *     The key is `writes`, not `scope`: `scope` already means "who a setting applies to" on settings
 *     and param rows.
 *   • `hosts: string[]` at the manifest's top level — every host the app's code reaches over the
 *     network. Usually empty; an empty list is a claim ("none"), a missing one is no claim at all.
 *
 * Pure core (`auditManifest`) + a thin CLI that loads every `apps/<app>/manifest.js`, so the self-test
 * can drive it with synthetic manifests.
 */
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isWritingVerb, WRITE_SCOPES } from '../packages/app-manifest/src/atoms.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

/** Does this op write? A writing atom, or an explicit `appends` declaration. */
export function isWritingOp(op) {
  return isWritingVerb(op?.verb) || op?.appends !== undefined;
}

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
  for (const op of manifest?.operations ?? []) {
    const id = op?.id ?? '(no id)';
    if (op?.writes !== undefined) {
      const scope = op.writes?.scope;
      if (!op.writes || typeof op.writes !== 'object' || !WRITE_SCOPES.includes(scope)) {
        problems.push({ opId: id, message: `writes.scope must be one of ${WRITE_SCOPES.join(' | ')} (got ${JSON.stringify(op.writes)})` });
      }
    } else if (isWritingOp(op)) {
      problems.push({ opId: id, message: `writing op (verb '${op.verb}'${op.appends !== undefined ? ', appends' : ''}) has no \`writes: { scope }\` declaration` });
    }
  }
  return problems;
}

/** Every app manifest in the repo: `{ app, manifest }`. */
export async function loadManifests(root = ROOT) {
  const appsDir = path.join(root, 'apps');
  const out = [];
  for (const app of readdirSync(appsDir).sort()) {
    const file = path.join(appsDir, app, 'manifest.js');
    if (!existsSync(file)) continue;
    const mod = await import(pathToFileURL(file).href);
    out.push({ app, manifest: mod.default });
  }
  return out;
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
  if (redManifests.size) {
    console.error(`lint-manifest-scopes: ${opCount} op problem(s) in ${redManifests.size} of ${manifests.length} manifest(s)`);
    process.exit(1);
  }
  console.log(`lint-manifest-scopes: ${manifests.length} manifests — every writing op declares where it writes, every manifest its hosts`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
