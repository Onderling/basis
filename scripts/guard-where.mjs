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

/** The list that names every manifest the app runs: where to look when a manifest's own file is not found. */
export const MANIFEST_LIST = 'apps/basis/src/v2/manifestSources.js';

/**
 * The repo file that declares each manifest, `{ app: rel }`, for a guard that holds the manifests as loaded objects.
 * Every `apps/<dir>/manifest.js` and `apps/basis/src/v2/*Manifest.js` is imported and its exports are matched to the
 * given manifests BY IDENTITY (a re-export under another name is still the same object). An app whose manifest is in
 * none of those files maps to the list that names it (`MANIFEST_LIST`).
 * @param {object[]} manifests
 * @returns {Promise<Record<string, string>>}
 */
export async function manifestFileByApp(manifests, root = ROOT) {
  const { readdirSync, existsSync } = await import('node:fs');
  const { pathToFileURL } = await import('node:url');
  const candidates = [];
  for (const d of readdirSync(path.join(root, 'apps'), { withFileTypes: true })) {
    if (d.isDirectory() && existsSync(path.join(root, 'apps', d.name, 'manifest.js'))) candidates.push(`apps/${d.name}/manifest.js`);
  }
  const v2 = 'apps/basis/src/v2';
  for (const f of readdirSync(path.join(root, v2))) if (/Manifest\.js$/.test(f)) candidates.push(`${v2}/${f}`);
  const want = new Set(manifests ?? []);
  const out = {};
  for (const rel of candidates) {
    let mod;
    try { mod = await import(pathToFileURL(path.join(root, rel)).href); } catch { continue; }
    for (const v of Object.values(mod)) if (want.has(v) && v?.app && !out[v.app]) out[v.app] = rel;
  }
  for (const m of manifests ?? []) if (m?.app && !out[m.app]) out[m.app] = MANIFEST_LIST;
  return out;
}

/** `rel:line` in a guard's own file for the first line holding `needle` (`metaUrl` is the guard's import.meta.url). */
export function whereInSelf(metaUrl, needle, root = ROOT) {
  return whereIn(path.relative(root, fileURLToPath(metaUrl)), needle, root);
}
