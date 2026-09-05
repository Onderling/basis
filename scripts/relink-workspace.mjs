#!/usr/bin/env node
/**
 * relink-workspace — rebuild the `node_modules` symlinks a partial pnpm install destroys.
 *
 * ── When you need this ───────────────────────────────────────────────────────────────────────────────────
 * The repo uses `node-linker=hoisted` with per-app lockfiles (see `.npmrc`). A `pnpm install --filter …`
 * that aborts partway — `ERR_PNPM_MISSING_HOISTED_LOCATIONS` is the usual way — leaves the tree
 * half-materialized: workspace packages replaced by COPIES instead of symlinks, and sibling links pruned
 * from packages you never asked it to touch. The symptom is a flood of
 *
 *     Cannot find package '@onderling/<x>' imported from …
 *     Could not resolve "@onderling/<x>" imported by "@onderling/<y>"
 *
 * across suites that were green ten minutes ago, in apps you did not change.
 *
 * Re-running the install often does not fix it (that is what produced the state). This rebuilds the links
 * directly, which is the recovery `docs/agent-notes-known-gotchas.md` has always prescribed by hand.
 *
 * ── What it does ─────────────────────────────────────────────────────────────────────────────────────────
 *   0. any workspace package sitting there as a real DIRECTORY (a copy) → replaced by a symlink. This is
 *      the trap's main symptom and the one that bites twice: a copy keeps working until shared code gains a
 *      NEW FILE, which the copy does not have, and then fails as `Cannot find module …/<newfile>.js`;
 *   1. every DECLARED `@onderling*` dep (dependencies + devDependencies + peerDependencies) → symlink;
 *   2. every IMPORTED-but-undeclared `@onderling*` package found in `src/` + `test/` → symlink. Several
 *      packages import siblings they never declared; a hoisted tree hid that, symlinks expose it;
 *   3. for any package whose `node_modules/` this created, its declared THIRD-PARTY deps → the repo-root
 *      store. Creating the directory interrupts Node's walk-up, so packages that resolved fine from the
 *      root suddenly cannot (this is how `ws` disappears for `@onderling/relay`).
 *
 * Idempotent. It only ever REMOVES a copied workspace package (step 0) — anything else already in place,
 * link or file, is left alone.
 *
 * Usage:  node scripts/relink-workspace.mjs [--dry]
 *
 * ⚠ Not a substitute for a real install. It restores RESOLUTION so the suites run; a fresh clone should
 * still install normally. And if the relay sqlite suites fail after this, that is the separate documented
 * one: `npm rebuild better-sqlite3`.
 */
import { readFileSync, existsSync, mkdirSync, symlinkSync, lstatSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname, relative, resolve, basename } from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const DRY  = process.argv.includes('--dry');

const readJson = (p) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; } };
const exists   = (p) => { try { lstatSync(p); return true; } catch { return false; } };

/** Every workspace package: name → real directory. */
function workspaces() {
  const out = new Map();
  for (const group of ['apps', 'packages']) {
    const dir = join(ROOT, group);
    if (!existsSync(dir)) continue;
    for (const entry of readdirSync(dir)) {
      const home = join(dir, entry);
      try { if (!statSync(home).isDirectory()) continue; } catch { continue; }
      const pkg = readJson(join(home, 'package.json'));
      if (pkg?.name) out.set(pkg.name, home);
    }
  }
  return out;
}

let made = 0;
const byHome = new Map();

let replaced = 0;

function link(home, name, target) {
  const dest = join(home, 'node_modules', ...name.split('/'));
  if (exists(dest)) {
    // A real directory where a workspace package belongs is a COPY left by a broken install. Leaving it is
    // worse than it looks: it keeps working until shared code gains a new file, then fails with a
    // `Cannot find module` naming a path that exists perfectly well at the real location.
    let isCopy = false;
    try { isCopy = !lstatSync(dest).isSymbolicLink() && statSync(dest).isDirectory(); } catch { isCopy = false; }
    if (!isCopy) return false;
    if (DRY) { replaced += 1; return true; }
    rmSync(dest, { recursive: true, force: true });
    replaced += 1;
  }
  if (!DRY) {
    mkdirSync(dirname(dest), { recursive: true });
    symlinkSync(relative(dirname(dest), target), dest);
  }
  made += 1;
  byHome.set(basename(home), [...(byHome.get(basename(home)) ?? []), name]);
  return true;
}

/** `@onderling*` specifiers actually imported under src/ + test/, declared or not. */
function importedNames(home) {
  const found = new Set();
  for (const sub of ['src', 'test']) {
    const dir = join(home, sub);
    if (!existsSync(dir)) continue;
    let out = '';
    try {
      out = execFileSync('grep', ['-rhoEI', "@onderling(-app)?/[a-z0-9-]+", dir],
        { encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
    } catch { /* grep exits 1 when nothing matches */ }
    for (const m of out.split('\n')) if (m.trim()) found.add(m.trim());
  }
  return found;
}

const ws = workspaces();

for (const [, home] of ws) {
  const pkg = readJson(join(home, 'package.json'));
  if (!pkg) continue;
  const declared = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  const hadNodeModules = existsSync(join(home, 'node_modules'));

  for (const name of new Set([...Object.keys(declared), ...importedNames(home)])) {
    const target = ws.get(name);
    if (target && target !== home) link(home, name, target);
  }

  // Only when WE created the directory: restore the root-store resolution its existence now shadows.
  if (!hadNodeModules && existsSync(join(home, 'node_modules'))) {
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) {
      if (name.startsWith('@onderling')) continue;
      const src = join(ROOT, 'node_modules', ...name.split('/'));
      if (existsSync(src)) link(home, name, src);
    }
  }
}

console.log(`${DRY ? '[dry] would create' : 'created'} ${made} symlink(s) across ${byHome.size} workspace(s)`
  + (replaced ? ` (${replaced} were COPIES, now symlinked)` : ''));
for (const [home, names] of [...byHome].sort()) {
  console.log(`  ${home} → ${names.sort().join(', ')}`);
}
if (!made) console.log('  (nothing to do — the tree is already linked)');
