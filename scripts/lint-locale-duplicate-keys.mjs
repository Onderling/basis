#!/usr/bin/env node
/**
 * NO KEY TWICE IN ONE LOCALE OBJECT. JSON.parse keeps the LAST of two equal keys in one object and drops the first
 * without a word, so a repeated key (a scripted insert beside an existing one, a merge that kept both) silently replaces
 * a translation. lint-locale-ownership compares keys ACROSS bundles; this reads each locale file for a key repeated
 * WITHIN one object, and names the path and the line.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every key that appears twice in the same object of a JSON text.
 * @param {string} text
 * @returns {Array<{path: string, key: string, line: number}>}
 */
export function duplicateKeys(text) {
  const out = [];
  const stack = [];   // one frame per open container: { keys: Set|null (array), path: string[], expectKey: boolean, lastKey }
  let i = 0; let line = 1;
  const readString = () => {
    let s = ''; i += 1;
    while (i < text.length) {
      const c = text[i];
      if (c === '\\') { s += text.slice(i, i + 2); i += 2; continue; }
      if (c === '"') { i += 1; return s; }
      if (c === '\n') line += 1;
      s += c; i += 1;
    }
    return s;
  };
  while (i < text.length) {
    const c = text[i];
    const top = stack[stack.length - 1];
    if (c === '\n') { line += 1; i += 1; continue; }
    if (c === '{' || c === '[') {
      const parentPath = top ? (top.keys ? [...top.path, top.lastKey ?? '?'] : [...top.path, '[]']) : [];
      stack.push({ keys: c === '{' ? new Set() : null, path: parentPath, expectKey: c === '{', lastKey: null });
      i += 1; continue;
    }
    if (c === '}' || c === ']') { stack.pop(); i += 1; continue; }
    if (c === ',') { if (top?.keys) top.expectKey = true; i += 1; continue; }
    if (c === ':') { if (top) top.expectKey = false; i += 1; continue; }
    if (c === '"') {
      const at = line;
      const s = readString();
      if (top?.keys && top.expectKey) {
        if (top.keys.has(s)) out.push({ path: top.path.join('.'), key: s, line: at });
        top.keys.add(s); top.lastKey = s;
      }
      continue;
    }
    i += 1;
  }
  return out;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const files = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n')
    .filter((f) => /(^|\/)locales\/.*\.json$/.test(f) && !f.includes('node_modules'));
  const problems = [];
  for (const f of files) {
    for (const d of duplicateKeys(readFileSync(path.join(ROOT, f), 'utf8'))) problems.push(`${f}:${d.line}: "${d.key}" twice in ${d.path || '(root)'}`);
  }
  if (problems.length) {
    console.error(`✖ lint-locale-duplicate-keys — a key repeated in one object (JSON keeps only the last):\n${problems.map((p) => `  • ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(`✓ lint-locale-duplicate-keys: ${files.length} locale files, no key twice in one object.`);
}
