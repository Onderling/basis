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
import { fileURLToPath } from 'node:url';
import { verbKind, WRITE_SCOPES } from '../packages/app-manifest/src/atoms.js';
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
  if (redManifests.size) {
    console.error(`lint-manifest-scopes: ${opCount} op problem(s) in ${redManifests.size} of ${manifests.length} manifest(s)`);
    process.exit(1);
  }
  console.log(`lint-manifest-scopes: ${manifests.length} manifests — every writing op declares where it writes, every manifest its hosts`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
