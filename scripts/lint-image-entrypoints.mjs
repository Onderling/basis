#!/usr/bin/env node
/**
 * lint-image-entrypoints — an image's entrypoint imports only Node builtins and relative paths.
 *
 * An image installs one package's dependency tree (`pnpm install --filter "<pkg>..."`), and pnpm places a package's
 * own dependencies beside it (`packages/relay/node_modules/…`), not at the root. A file under `deploy/` resolves bare
 * specifiers from `deploy/…` upward, so it finds them only when something happened to hoist them — always on a
 * developer's machine (the whole workspace is installed), never in the image. That is how a release took the public
 * relay down (2026-09-28): the entrypoint imported `better-sqlite3` itself, which the relay package declares and the
 * image installs under `packages/relay/`; the container could not start and the box rolled back. The entrypoint
 * already reached the workspace by relative paths for this reason; this makes the rule a check. A native or bare
 * dependency is loaded by the package that declares it (e.g. the relay's `loadSqlite`).
 *
 * Checks every `deploy/<image>/entrypoint.mjs`: static imports and string-literal dynamic `import()`.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The bare specifiers a module imports (neither `node:` nor relative).
 * @param {string} source
 * @returns {string[]}
 */
export function bareImports(source) {
  const specs = new Set();
  const text = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const m of text.matchAll(/\bimport\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g)) specs.add(m[1]);
  for (const m of text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.add(m[1]);
  return [...specs].filter((s) => !s.startsWith('node:') && !s.startsWith('./') && !s.startsWith('../')).sort();
}

/** Every `deploy/<image>/entrypoint.mjs`. */
export function entrypoints(root = ROOT) {
  const base = path.join(root, 'deploy');
  if (!existsSync(base)) return [];
  return readdirSync(base)
    .map((d) => path.join('deploy', d, 'entrypoint.mjs'))
    .filter((rel) => existsSync(path.join(root, rel)))
    .sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = entrypoints();
  const found = files.map((rel) => ({ rel, bare: bareImports(readFileSync(path.join(ROOT, rel), 'utf8')) }))
    .filter((f) => f.bare.length);
  if (found.length) {
    console.error(`\n✖ lint-image-entrypoints: ${found.length} image entrypoint(s) import a bare package — resolved from deploy/, it is not there in the image:`);
    for (const f of found) console.error(`  ${f.rel}: ${f.bare.join(', ')}`);
    console.error('\nFix: load it through the package that declares it (a relative import of that package), never from the entrypoint.\n');
    process.exit(1);
  }
  console.log(`✓ lint-image-entrypoints: ${files.length} image entrypoint(s), only builtins and relative imports.`);
}
