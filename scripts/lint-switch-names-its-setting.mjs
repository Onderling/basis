#!/usr/bin/env node
/**
 * EVERY SWITCH NAMES WHAT IT SETS. A switch a person can flip that changes nothing is a promise unkept (the settings
 * walk of 2026-10-22 found toggles for features with no surface). So every switch on both shells — a web checkbox or
 * `role="switch"`, an RN `<Switch>` — carries a mark on its line, `sets: <kind>[:<ref>]`, saying where the flip lands:
 *
 *   op:<opId>       an op (checked: some manifest declares it)        op:*      the row's declared op
 *   param:<key>     a parameter (checked: the key exists in source)   param:*   the row's key in the register
 *   local:<key>     this device's storage (checked: something reads it back)
 *   policy:<field>  the circle's policy, an admin's statement         store:<what>   a store the screen saves to
 *   device:<what>   this device's own permission or subscription      form      a field of the act its button submits
 *   view            what the screen shows (a filter), saving nothing
 *
 * A switch without a mark, an unknown kind, or a reference that does not exist fails. The mark is a statement a
 * reviewer reads beside the switch; the reference check keeps it from naming something that is gone.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KINDS = new Set(['op', 'param', 'local', 'policy', 'store', 'device', 'form', 'view']);
const WEB_SWITCH = /\.type\s*=\s*['"]checkbox['"]|setAttribute\(\s*['"]role['"]\s*,\s*['"]switch['"]\s*\)/;
const RN_SWITCH = /<Switch\b/;
const MARK = /sets:\s*([a-z]+)(?::([A-Za-z0-9_.*:-]+))?/;

/**
 * @param {Array<{file: string, text: string}>} sources   the shell files to read for switches
 * @param {{ops: Set<string>, sourceText: string}} facts  every declared op id; all source text (for params and reads)
 * @returns {string[]} problems
 */
export function switchProblems(sources, { ops, sourceText }) {
  const problems = [];
  for (const { file, text } of sources) {
    text.split('\n').forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (!WEB_SWITCH.test(line) && !RN_SWITCH.test(line)) return;
      const where = `${file}:${i + 1}`;
      const m = MARK.exec(line);
      if (!m) { problems.push(`${where}: a switch with no "sets:" mark — name the op or param it sets`); return; }
      const [, kind, ref] = m;
      if (!KINDS.has(kind)) { problems.push(`${where}: unknown kind "${kind}" (one of ${[...KINDS].join(', ')})`); return; }
      if (kind === 'op' && ref && ref !== '*' && !ops.has(ref)) problems.push(`${where}: sets op "${ref}", which no manifest declares`);
      if (kind === 'param' && ref && ref !== '*') {
        const prefix = ref.endsWith('.*') ? ref.slice(0, -1) : null;
        const known = prefix ? new RegExp(`['"]${prefix.replace(/\./g, '\\.')}[A-Za-z]`).test(sourceText) : sourceText.includes(`'${ref}'`);
        if (!known) problems.push(`${where}: sets param "${ref}", which nothing declares`);
      }
      if (kind === 'local' && ref && !sourceText.includes(`getItem('${ref}')`)) problems.push(`${where}: sets local "${ref}", which nothing reads back`);
      if ((kind === 'op' || kind === 'param' || kind === 'local') && !ref) problems.push(`${where}: "${kind}" needs a reference (or "*" for a row-declared one)`);
    });
  }
  return problems;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const ls = (globs) => execSync(`git ls-files ${globs}`, { cwd: ROOT, encoding: 'utf8' }).split('\n').filter(Boolean);
  const notTest = (f) => !/(^|\/)(test|test-browser|__tests__|e2e)\//.test(f) && !/\.test\.m?js$/.test(f);
  const shellFiles = ls('apps/basis/web apps/basis/src apps/basis-mobile/src').filter((f) => /\.(js|jsx)$/.test(f) && notTest(f));
  const read = (f) => { try { return readFileSync(path.join(ROOT, f), 'utf8'); } catch { return ''; } };
  const sources = shellFiles.map((file) => ({ file, text: read(file) }));
  const ops = new Set();
  for (const f of ls("'apps/*/manifest.js'")) for (const m of read(f).matchAll(/(?:\bid|opId)\s*:\s*['"]([A-Za-z0-9_-]+)['"]/g)) ops.add(m[1]);
  const sourceText = ls('apps packages').filter((f) => /\.(m?js|jsx)$/.test(f) && notTest(f) && !f.includes('node_modules')).map(read).join('\n');
  const problems = switchProblems(sources, { ops, sourceText });
  const count = sources.reduce((n, { text }) => n + text.split('\n').filter((l) => !/^\s*(\/\/|\*)/.test(l) && (WEB_SWITCH.test(l) || RN_SWITCH.test(l))).length, 0);
  if (problems.length) {
    console.error(`✖ lint-switch-names-its-setting — ${problems.length} switch(es) that do not say what they set:\n${problems.map((p) => `  • ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`✓ lint-switch-names-its-setting: ${count} switches on both shells, each names what it sets.`);
}
