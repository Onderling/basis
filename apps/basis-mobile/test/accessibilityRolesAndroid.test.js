/**
 * FITNESS — every accessibility role the phone paints is one Android accepts.
 *
 * Android's React Native turns `accessibilityRole` into a native enum and THROWS on a value it does not know
 * (`IllegalArgumentException: Invalid accessibility role value: …` in ReactAccessibilityDelegate) — the app dies at the
 * moment the view paints. The act strip used `"status"` (2026-11-07): the first act after joining a circle closed the
 * app on the emulator (2026-11-11, the messaging walk). Vitest never renders a screen and the web shell has no such
 * check, so nothing caught it.
 *
 * The allowed set is read from React Native's OWN Android source (the AccessibilityRole enum), not copied here: an
 * upgrade that adds or drops a role moves this test with it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.join(HERE, '..');
const DELEGATE = path.join(APP, 'node_modules/react-native/ReactAndroid/src/main/java/com/facebook/react/uimanager/ReactAccessibilityDelegate.java');

/** The enum's constants, lower-cased: what `AccessibilityRole.fromValue` accepts. */
function androidRoles() {
  const src = readFileSync(DELEGATE, 'utf8');
  const start = src.search(/enum\s+AccessibilityRole\s*\{/);
  if (start < 0) return null;
  const body = src.slice(start, src.indexOf(';', start));
  return new Set([...body.matchAll(/^\s*([A-Z][A-Z_]*)\s*[,;(]?\s*$/gm)].map((m) => m[1].toLowerCase()));
}

function* sourceFiles(dir) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) { if (name !== 'node_modules') yield* sourceFiles(p); }
    else if (/\.(js|jsx|tsx?)$/.test(name)) yield p;
  }
}

/** Every role value named in the phone's source: `accessibilityRole="x"` and each quoted value in `accessibilityRole={…}`. */
function rolesInSource() {
  const out = [];
  for (const file of [path.join(APP, 'App.js'), ...sourceFiles(path.join(APP, 'src'))]) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/accessibilityRole\s*=\s*"([^"]+)"/g)) out.push({ file, role: m[1] });
    for (const m of src.matchAll(/accessibilityRole\s*=\s*\{([^}]*)\}/g)) {
      // the values the expression can RESULT in: the whole expression, or a branch after `?` / `:` / `??` / `||`
      // (a quoted operand of a comparison, `x === 'failed'`, is not a role)
      for (const q of m[1].matchAll(/(?:^\s*|[?:]\s*|\?\?\s*|\|\|\s*)['"]([a-z]+)['"]/g)) out.push({ file, role: q[1] });
    }
    for (const m of src.matchAll(/accessibilityRole\s*:\s*['"]([a-z]+)['"]/g)) out.push({ file, role: m[1] });
  }
  return out;
}

describe('FITNESS — the phone paints only accessibility roles Android accepts', () => {
  const allowed = androidRoles();

  it('reads the allowed roles from React Native\'s Android source', () => {
    expect(allowed, `AccessibilityRole enum not found in ${DELEGATE}`).not.toBeNull();
    expect(allowed.has('button') && allowed.has('alert'), 'the enum read looks wrong').toBe(true);
  });

  it('finds the roles the phone paints', () => {
    expect(rolesInSource().length).toBeGreaterThan(100);
  });

  it('every role is one Android knows (an unknown one crashes the app when its view paints)', () => {
    const bad = rolesInSource().filter((r) => !allowed.has(r.role)).map((r) => `${path.relative(APP, r.file)}: "${r.role}"`);
    expect(bad, 'roles Android rejects with IllegalArgumentException').toEqual([]);
  });
});
