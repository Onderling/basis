/**
 * guard-where — small helpers a guard uses to say WHERE a finding is, as file:line, so its red message points at the
 * line to change instead of only the file.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** The 1-based line of a character index in a text. */
export function lineAt(text, index) {
  return String(text).slice(0, Math.max(0, index)).split('\n').length;
}

/** The 1-based lines whose text matches `re` (a line counts once). */
export function linesMatching(text, re) {
  const one = new RegExp(re.source, re.flags.replace('g', ''));
  const out = [];
  String(text).split('\n').forEach((l, i) => { if (one.test(l)) out.push(i + 1); });
  return out;
}

/** The 1-based line of the first line holding `needle` in a text, or 1 when none does (the top of the file). */
export function lineOf(text, needle) {
  const i = String(text).split('\n').findIndex((l) => l.includes(needle));
  return i < 0 ? 1 : i + 1;
}

/** `rel:line` for the first line holding `needle` in a repo file (`rel` is repo-relative; line 1 when not found). */
export function whereIn(rel, needle, root = ROOT) {
  let text = '';
  try { text = readFileSync(path.join(root, rel), 'utf8'); } catch { /* missing file: point at its top */ }
  return `${rel}:${lineOf(text, needle)}`;
}

/** `rel:line` in a guard's own file for the first line holding `needle` (`metaUrl` is the guard's import.meta.url). */
export function whereInSelf(metaUrl, needle, root = ROOT) {
  return whereIn(path.relative(root, fileURLToPath(metaUrl)), needle, root);
}
