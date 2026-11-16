#!/usr/bin/env node
/**
 * lint-themed-inputs — every text input takes its colours from the theme, never from the platform.
 *
 * Why (Frits 2026-11-16, firmly, about the phone under the system dark theme: "virtually every text input box" showed
 * dark text on a dark background): the Android app theme sets every EditText's text black and its hint light grey, so
 * an RN TextInput that set no colour of its own painted black text on the app's dark screens. The phone app now has
 * ONE text input, `ThemedTextInput` (apps/basis-mobile/src/screens/v2/ThemedTextInput.js), whose text, placeholder and
 * cursor come from the theme. This guard fails:
 *   1. a raw RN `<TextInput` (or an import of `TextInput` from react-native) anywhere in apps/basis-mobile/src outside
 *      ThemedTextInput.js;
 *   2. a rule in the web app's stylesheet (apps/basis/web/v2/circle.css) that styles a text input (input, textarea,
 *      select, or an `-input`/`-textarea` class) and sets its background without its text colour: the page declares
 *      `color-scheme: light dark`, so an input with neither follows the theme; one with only a background does not.
 *
 * LINT_THEMED_INPUTS_ROOT points the guard at a fixture tree (its self-test).
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.LINT_THEMED_INPUTS_ROOT || dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, 'apps/basis-mobile/src');
const THEMED = join(SRC, 'screens/v2/ThemedTextInput.js');
const CSS = join(ROOT, 'apps/basis/web/v2/circle.css');
const errors = [];

const files = [];
const walk = (d) => { for (const f of readdirSync(d)) { const p = join(d, f); if (statSync(p).isDirectory()) walk(p); else if (/\.(js|jsx|ts|tsx)$/.test(f)) files.push(p); } };
if (existsSync(SRC)) walk(SRC);
for (const f of files) {
  if (f === THEMED) continue;
  const s = readFileSync(f, 'utf8');
  const code = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const rel = relative(ROOT, f);
  if (/<TextInput\b/.test(code)) errors.push(`${rel}: a raw <TextInput>: use ThemedTextInput, so its text, placeholder and cursor follow the theme`);
  if (/import\s*\{[^}]*\bTextInput\b[^}]*\}\s*from\s*['"]react-native['"]/.test(code)) errors.push(`${rel}: imports TextInput from react-native: use ThemedTextInput`);
}

if (existsSync(CSS)) {
  const css = readFileSync(CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const sel = m[1].trim(); const body = m[2];
    if (!/\b(input|textarea|select)\b|-input\b|-textarea\b/.test(sel) || /checkbox|radio|:has\(|::placeholder/.test(sel)) continue;
    const colour = /(^|[;\s])color\s*:/.test(body);
    const background = /background(-color)?\s*:/.test(body);
    if (background && !colour) {
      const line = css.slice(0, m.index).split('\n').length;
      errors.push(`apps/basis/web/v2/circle.css:${line}: "${sel.slice(0, 80)}" sets an input's background but not its text colour`);
    }
  }
}

if (errors.length) {
  console.error(`✖ lint-themed-inputs — ${errors.length} input(s) whose colours do not come from the theme:\n`);
  for (const e of errors) console.error(`  • ${e}`);
  process.exit(1);
}
console.log(`✔ lint-themed-inputs — every phone text input is ThemedTextInput (${files.length} files); every web input rule with a background sets its colour.`);
