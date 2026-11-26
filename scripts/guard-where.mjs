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

/** A JSON text read as objects whose members carry the line their key stands on: `{ key: { line, value } }`;
 *  arrays and scalars come back as null (no key below them). Throws on text that is not JSON. */
function keyLines(text) {
  const s = String(text);
  let i = 0;
  let line = 1;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) { if (s[i] === '\n') line += 1; i += 1; } };
  const str = () => {
    let out = '';
    i += 1;
    while (i < s.length && s[i] !== '"') {
      if (s[i] === '\\') { out += s[i + 1] === '"' ? '"' : s[i] + s[i + 1]; i += 2; } else { out += s[i]; i += 1; }
    }
    if (s[i] !== '"') throw new Error('unterminated string');
    i += 1;
    return out;
  };
  const value = () => {
    ws();
    if (s[i] === '{') {
      i += 1;
      const obj = Object.create(null);
      ws();
      if (s[i] === '}') { i += 1; return obj; }
      for (;;) {
        ws();
        if (s[i] !== '"') throw new Error('key expected');
        const at = line;
        const k = str();
        ws();
        if (s[i] !== ':') throw new Error('colon expected');
        i += 1;
        obj[k] = { line: at, value: value() };
        ws();
        if (s[i] === ',') { i += 1; continue; }
        if (s[i] === '}') { i += 1; return obj; }
        throw new Error('comma or brace expected');
      }
    }
    if (s[i] === '[') {
      i += 1;
      ws();
      if (s[i] === ']') { i += 1; return null; }
      for (;;) {
        value();
        ws();
        if (s[i] === ',') { i += 1; continue; }
        if (s[i] === ']') { i += 1; return null; }
        throw new Error('comma or bracket expected');
      }
    }
    if (s[i] === '"') { str(); return null; }
    const start = i;
    while (i < s.length && !/[,}\]\s]/.test(s[i])) i += 1;
    if (i === start) throw new Error('value expected');
    return null;
  };
  return value();
}

/** The last text read and its tree: a guard asks for many keys of one file in a row. */
const LAST = { text: null, tree: null };

/**
 * The 1-based line where a key is defined in a locale JSON file's text, or 1 when it is not there (the top of the file).
 * `key` is a dotted path through nested objects (`circle.share.stop`); a flat file whose keys hold dots themselves
 * (`"assistant.hello"`) is found too, and so is a mix of both. The path is followed from the root, so the same leaf
 * name under another parent, or inside a value, does not match.
 */
export function lineOfKey(text, key) {
  const t = String(text);
  if (LAST.text !== t) {
    LAST.text = t;
    try { LAST.tree = keyLines(t); } catch { LAST.tree = null; }
  }
  const tree = LAST.tree;
  const segs = String(key).split('.');
  const find = (node, from) => {
    if (!node || typeof node !== 'object') return null;
    for (let to = segs.length; to > from; to -= 1) {
      const member = node[segs.slice(from, to).join('.')];
      if (!member) continue;
      if (to === segs.length) return member.line;
      const deeper = find(member.value, to);
      if (deeper) return deeper;
    }
    return null;
  };
  return find(tree, 0) ?? 1;
}
