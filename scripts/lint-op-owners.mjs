#!/usr/bin/env node
/**
 * lint-op-owners — one owner per op. The op ids two or more composed manifests BOTH declare are a baseline that only
 * SHRINKS, and no new collision may appear.
 *
 * The basis agent composes several apps' manifests; when two declare the same op id, which one a call reaches is
 * decided by registration order, not by the contract. Folding the in-process agents into one makes that a silent
 * overwrite, so the duplicates are removed one owner at a time — and none added meanwhile. (The same rule for the
 * skills the in-process agents register at runtime, which include ops no manifest declares, is the fitness test
 * apps/basis/test/fitness/inProcessSkillOwners.test.js.)
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The op ids declared by more than one manifest today, with their owners. Only ever remove from this. */
export const OP_OWNER_BASELINE = {
  help: ['basis', 'household'],
  addTask: ['tasks', 'household'],
  listOpen: ['tasks', 'household', 'pinboard'],
};

/** Op id → the manifests that declare it, for those declared more than once. */
export function opCollisions(manifests) {
  const owners = new Map();
  for (const m of manifests) {
    const name = m.id ?? m.app ?? m.name ?? '?';
    for (const op of m.operations ?? []) {
      if (!owners.has(op.id)) owners.set(op.id, []);
      if (!owners.get(op.id).includes(name)) owners.get(op.id).push(name);
    }
  }
  return Object.fromEntries([...owners].filter(([, a]) => a.length > 1));
}

/** Every difference from the baseline, as messages. */
export function opOwnerProblems(collisions, baseline = OP_OWNER_BASELINE) {
  const out = [];
  for (const [op, owners] of Object.entries(collisions)) {
    const known = baseline[op];
    if (!known) { out.push(`a NEW op declared by more than one manifest: ${op} (${owners.join(' + ')}) — one owner per op`); continue; }
    const added = owners.filter((o) => !known.includes(o));
    if (added.length) out.push(`${op} gained an owner: ${added.join(', ')} — one owner per op`);
  }
  for (const [op, known] of Object.entries(baseline)) {
    const now = collisions[op] ?? [];
    if (now.length < known.length) out.push(`${op} has fewer owners than the baseline (${now.join(' + ') || 'none'}) — shrink OP_OWNER_BASELINE`);
  }
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const { allManifests } = await import(pathToFileURL(path.join(ROOT, 'apps/basis/src/v2/manifestSources.js')).href);
  const problems = opOwnerProblems(opCollisions(allManifests()));
  if (problems.length) {
    console.error('lint-op-owners:');
    for (const p of problems) console.error(`  • ${p}`);
    process.exit(1);
  }
  console.log(`lint-op-owners: ${Object.keys(OP_OWNER_BASELINE).length} shared op ids (baseline), none new`);
}
