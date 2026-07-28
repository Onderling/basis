/**
 * The APP layer rule — a shell imports its COMPOSER, and nothing else from `apps/`.
 *
 * Invariant 5 states the layering for `packages/` and never stated it for `apps/`. This is the guard for
 * the app half (→ `docs/conventions/architectural-layering.md`).
 *
 * Why it matters: the composer is where an op is resolved. A shell that can reach an app directly can
 * resolve one itself — which is how logic drifts into a shell (invariant 1). The drift showed up here as
 * four apps declared in `package.json` that nothing imported; the code was already clean, and this is what
 * keeps it that way.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SHELL_ROOT = new URL('..', import.meta.url).pathname;
const COMPOSER = '@onderling-app/basis';

/** Every `@onderling-app/*` specifier under a directory. */
function appImports(dir) {
  const found = new Set();
  const walk = (d) => {
    for (const entry of readdirSync(d)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      const full = join(d, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!/\.(js|jsx|ts|tsx)$/.test(entry)) continue;
      for (const m of readFileSync(full, 'utf8').matchAll(/@onderling-app\/[a-z0-9-]+/g)) found.add(m[0]);
    }
  };
  walk(dir);
  return found;
}

describe('a shell imports its composer and nothing else from apps/', () => {
  it('basis-mobile source reaches no app directly', () => {
    const used = appImports(join(SHELL_ROOT, 'src'));
    expect([...used].filter((n) => n !== COMPOSER)).toEqual([]);
  });

  it('and declares no app dependency it does not import', () => {
    // The failure this catches is the one that actually happened: four apps listed in package.json that
    // nothing imported. Harmless until someone reads the manifest and concludes the bypass is sanctioned.
    const pkg = JSON.parse(readFileSync(join(SHELL_ROOT, 'package.json'), 'utf8'));
    const declared = Object.keys(pkg.dependencies ?? {}).filter((k) => k.startsWith('@onderling-app/'));
    expect(declared).toEqual([COMPOSER]);
  });
});
