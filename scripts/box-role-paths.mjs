#!/usr/bin/env node
/**
 * box-role-paths — generate (or check) `deploy/roles/<role>.paths`: the repo paths a box role's image
 * is actually built from.
 *
 * Why: the box rebuilds a role on every release, and `COPY . .` in the deploy Dockerfiles means ANY
 * change to the repo produces a new image — so a docs-only release recreated the public relay
 * container, dropping its in-memory hold-and-forward queue and disconnecting every client (seen on
 * the real box 2026-09-07: relay up 10 h after a release that touched only the web app). With a
 * `.paths` file the updater rebuilds a role only when one of ITS paths changed.
 *
 * A role may name paths the closure cannot know — a file its health check runs from inside the image,
 * say — with a `# box-paths: <prefix>` comment in its compose fragment.
 *
 * The rest of the list is DERIVED, never hand-written: the role's compose fragment names a build context and a
 * Dockerfile, the Dockerfile names the workspace package it installs (`pnpm install --filter "<pkg>..."`),
 * and that package's workspace dependency closure is read from the package.json files — plus every app or package
 * its source reaches by a RELATIVE import (`../../stoop/src/lib/contactCard.js`), which no package.json names: the
 * image holds the whole tree, so that file is in it, and a change to it must rebuild the role. Relative volume
 * mounts (a script the role runs from the repo) count too. A role with no build section gets its own
 * files plus its mounts.
 *
 *   node scripts/box-role-paths.mjs            # check: nonzero + a diff when a file is stale/missing
 *   node scripts/box-role-paths.mjs --update   # write them
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROLES = path.join(ROOT, 'deploy/roles');
// Every image is built from the repo root with these; a change to any of them can change any image.
const ROOT_BUILD_FILES = ['package.json', 'pnpm-lock.yaml', 'package-lock.json', '.npmrc', '.dockerignore'];

/** name → { dir, deps } for every workspace package. */
function workspacePackages() {
  const pkgs = new Map();
  for (const group of ['packages', 'apps']) {
    const dir = path.join(ROOT, group);
    if (!existsSync(dir)) continue;
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const f = path.join(dir, e.name, 'package.json');
      if (!existsSync(f)) continue;
      try {
        const j = JSON.parse(readFileSync(f, 'utf8'));
        if (j.name) pkgs.set(j.name, { dir: `${group}/${e.name}`, deps: Object.keys({ ...j.dependencies, ...j.optionalDependencies }) });
      } catch { /* an unreadable package.json is not a package for our purposes */ }
    }
  }
  return pkgs;
}

/** The workspace dependency closure of a package, as repo-relative directories. */
export function closureDirs(pkgs, start) {
  const seen = new Set();
  const walk = (name) => {
    if (seen.has(name) || !pkgs.has(name)) return;
    seen.add(name);
    for (const d of pkgs.get(name).deps) walk(d);
  };
  walk(start);
  return [...seen].map((n) => `${pkgs.get(n).dir}/`).sort();
}

/** Source files under a repo-relative dir (no node_modules, no tests: a test's import is not in the running image). */
function listSource(dir) {
  const out = [];
  const walk = (rel) => {
    let entries = [];
    try { entries = readdirSync(path.join(ROOT, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const r = path.posix.join(rel, e.name);
      if (e.isDirectory()) { if (!/^(node_modules|test|tests|__tests__|e2e|dist)$/.test(e.name)) walk(r); }
      else if (/\.(m?js|cjs)$/.test(e.name) && !/\.test\./.test(e.name)) out.push(r);
    }
  };
  walk(dir.replace(/\/$/, ''));
  return out;
}

/** The top dir (`apps/x/` or `packages/x/`) a repo-relative file sits in, or null. */
const topDir = (f) => { const m = /^((?:apps|packages)\/[^/]+)\//.exec(f); return m ? `${m[1]}/` : null; };

/**
 * The apps and packages the source in `dirs` reaches by RELATIVE imports outside its own top dir — file by file, so
 * only what an imported file itself imports is followed (never the rest of that app). Tests are not followed.
 * @param {string[]} dirs  repo-relative dirs (`apps/companion-node/`)
 * @param {{read?: (f: string) => string, list?: (dir: string) => string[]}} [io]
 * @returns {string[]} sorted top dirs outside `dirs`
 */
export function relativeReach(dirs, { read = (f) => readFileSync(path.join(ROOT, f), 'utf8'), list = listSource } = {}) {
  const own = new Set(dirs);
  const reached = new Set();
  const seen = new Set();
  const queue = dirs.flatMap((d) => list(d)).filter((f) => !/(^|\/)(test|tests|__tests__)\//.test(f) && !/\.test\./.test(f));
  while (queue.length) {
    const f = queue.pop();
    if (seen.has(f)) continue;
    seen.add(f);
    let text = '';
    try { text = read(f) ?? ''; } catch { continue; }
    for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(f), m[1]));
      const top = topDir(target);
      if (!top) continue;
      if (!own.has(top)) reached.add(top);
      queue.push(target);
    }
  }
  return [...reached].sort();
}

/** The paths one role is built from. `yml` is the role's compose fragment text. */
export function pathsForRole(role, yml, pkgs = workspacePackages(), readFile = (p) => readFileSync(path.join(ROOT, p), 'utf8')) {
  const out = new Set([`deploy/roles/${role}.`]);
  // paths the closure cannot know, declared by the role itself
  for (const m of yml.matchAll(/^#\s*box-paths:\s*(\S+)\s*$/gm)) out.add(m[1]);
  // relative host paths the role mounts (a script it runs from the repo); ${BOX_DIR}/… is box data, not repo.
  // compose resolves them against the FRAGMENT's directory, deploy/roles/ — not deploy/.
  const rel = (p) => path.posix.normalize(`deploy/roles/${p}`);
  for (const m of yml.matchAll(/^\s*-\s+(\.\.[^:\s]*):/gm)) out.add(rel(m[1]));
  const df = yml.match(/^\s*dockerfile:\s*(\S+)\s*$/m)?.[1];
  const ctx = yml.match(/^\s*context:\s*(\S+)\s*$/m)?.[1];
  if (df) {
    out.add(path.posix.dirname(df) + '/');
    let text = '';
    try { text = readFile(df); } catch { /* a role naming a Dockerfile we cannot read stays conservative */ }
    const pkg = text.match(/--filter\s+"([^".]+)\.\.\."/)?.[1];
    if (pkg && pkgs.has(pkg)) {
      const dirs = closureDirs(pkgs, pkg);
      for (const d of dirs) out.add(d);
      for (const d of relativeReach(dirs)) out.add(d);
    }
    else if (text) out.add('');   // '' = matches everything: we could not narrow it, so never skip this role
    for (const f of ROOT_BUILD_FILES) out.add(f);
  } else if (ctx && ctx.startsWith('..')) {
    out.add(rel(ctx).replace(/\/?$/, '/'));
  }
  return [...out].sort();
}

const HEADER = [
  '# GENERATED by scripts/box-role-paths.mjs — do not edit by hand.',
  '# The repo paths this role\'s image is built from. deploy/box/update.sh rebuilds the role only when a',
  '# release changed one of them, so an unrelated release does not recreate (and interrupt) this service.',
  '# An empty line means "any change" — the role could not be narrowed and is always rebuilt.',
].join('\n');

function render(role, list) { return `${HEADER}\n${list.join('\n')}\n`; }

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();

function main() {
const update = process.argv.includes('--update');
const pkgs = workspacePackages();
let stale = 0;
for (const f of readdirSync(ROLES).filter((n) => n.endsWith('.yml')).sort()) {
  const role = f.replace(/\.yml$/, '');
  const yml = readFileSync(path.join(ROLES, f), 'utf8');
  const want = render(role, pathsForRole(role, yml, pkgs));
  const at = path.join(ROLES, `${role}.paths`);
  const have = existsSync(at) ? readFileSync(at, 'utf8') : null;
  if (have === want) continue;
  stale += 1;
  if (update) { writeFileSync(at, want); console.log(`wrote deploy/roles/${role}.paths`); }
  else console.error(`✗ deploy/roles/${role}.paths is ${have === null ? 'missing' : 'stale'} — run \`npm run box-role-paths\``);
}
if (!update) console.log(stale ? `box-role-paths: ${stale} stale` : 'box-role-paths: every role declares its build paths');
process.exit(stale && !update ? 1 : 0);
}
