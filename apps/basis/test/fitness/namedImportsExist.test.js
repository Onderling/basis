/**
 * FITNESS FUNCTION — a named import must be a name the target module actually exports.
 *
 * Under a real ES module loader this is a link-time error and nothing runs. Both shells are bundled
 * (Metro on mobile, the web build for the browser) and both transpile modules to CommonJS, where a
 * missing named export is not an error at all — the binding is simply `undefined`. So the file loads,
 * the screen renders, and the wrong thing happens only where the name is USED.
 *
 * Found by walking the phone, 2026-08-31. `CircleProfileScreen` imported `currentLang` from mobile's
 * `core/localisation.js`, which keeps `currentLang` as a module-local `let` and exports the reader as
 * `lang()` — the WEB module is the one that exports `currentLang`. So `currentLang()` threw inside the
 * argument list of a `Promise.all`, the whole load rejected, and the Me tab showed empty Handle and
 * Display name for a profile that had both, with an offering picker holding zero of its ten categories.
 * Nobody could publish an offering from the phone. Nothing failed: no test renders that screen, and the
 * rejection was an unhandled promise nobody was watching.
 *
 * The class has bitten the other way too, and loudly — `circleApp.js` still carries the comment about
 * `bootRelayUrl` never being imported and taking the whole web shell down with a blank page. Loud is
 * survivable. This check is for the silent direction.
 *
 * Deliberately narrow: relative imports only (a package's exports are its own contract, and `export *`
 * re-exports cannot be resolved this cheaply). It reads source rather than importing anything — these
 * modules pull in React Native.
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** Comments do not import anything — strip them before asking what a file imports. */
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

/** The names a module exports, read off its source. `null` when the file is not there to read. */
function exportsOf(abs) {
  const file = existsSync(abs) ? abs : (existsSync(`${abs}.js`) ? `${abs}.js` : null);
  if (!file) return null;
  let src; try { src = strip(readFileSync(file, 'utf8')); } catch { return null; }
  if (/^export\s+\*/m.test(src)) return '*';                    // re-export: not resolvable here
  const names = new Set();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s*\*?\s*(\w+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s+(?:const|let|var|class)\s+(\w+)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    for (const part of m[1].split(',')) {
      const as = part.split(/\s+as\s+/);
      const name = (as[1] ?? as[0]).trim();
      if (name) names.add(name);
    }
  }
  return names;
}

const SCOPE = ['apps/basis-mobile/src/', 'apps/basis/src/', 'apps/basis/web/'];

function danglingImports() {
  const files = execSync(`git ls-files ${SCOPE.map((s) => `'${s}'`).join(' ')}`, { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => !/\.test\.|\/test\//.test(f));

  const bad = [];
  for (const f of files) {
    const src = strip(readFileSync(path.join(ROOT, f), 'utf8'));
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"](\.[^'"]*)['"]/g)) {
      const names = exportsOf(path.resolve(path.dirname(path.join(ROOT, f)), m[2]));
      if (!names || names === '*') continue;
      for (const raw of m[1].split(',')) {
        const name = raw.split(/\s+as\s+/)[0].trim();
        if (name && !names.has(name)) bad.push(`${f} imports { ${name} } from '${m[2]}', which does not export it`);
      }
    }
  }
  return bad;
}

describe('every named import names something the target exports', () => {
  it('no shell file imports a name its target does not export', () => {
    expect(danglingImports(), 'the bundlers turn this into `undefined` instead of an error, so it '
      + 'surfaces as a screen that quietly does not work').toEqual([]);
  });

  it('the reader can see an export list at all (it is not vacuously green)', () => {
    // If `exportsOf` silently returned an empty set the check above would pass forever.
    const names = exportsOf(path.join(ROOT, 'apps/basis-mobile/src/core/localisation.js'));
    expect(names, 'the module was read').toBeInstanceOf(Set);
    expect(names.has('lang'), 'and its real export is there').toBe(true);
    expect(names.has('currentLang'), 'while the web-shaped name is not — the bug this was found by').toBe(false);
  });
});
