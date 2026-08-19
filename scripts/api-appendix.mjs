// api-appendix — the per-function API reference generator (code → docs/api/).
//
// For every wave-1 package: import each entry in its `exports` map (the same resolution a
// consumer gets — the readme-fitness importOnderling pattern), take the RUNTIME export list as
// the authoritative public surface, then statically walk the barrel re-export chain
// (`export { X } from`, `export * from`, cross-package `export * from '@onderling/…'`) to the
// defining declaration and its preceding JSDoc block. Parse the JSDoc pragmatically
// (description / @param / @returns / @deprecated — types kept verbatim, this repo writes
// TS-flavoured type expressions that stock JSDoc tooling rejects) and emit one markdown file
// per package under docs/api/, plus docs/api/README.md (index + JSDoc-coverage table).
//
// Symbols re-exported from ANOTHER wave-1 package (the @onderling/sdk facade case) are listed
// as compact link tables into that package's own reference — one canonical entry per symbol.
//
// Off-the-shelf tools were evaluated first (2026-07-16) and rejected for fidelity:
//   - documentation.js: documents non-exported internals, silently DROPS undocumented public
//     exports and alias exports, mangles destructured params to `$0.min`.
//   - jsdoc-to-markdown: hard-errors on this repo's TS-flavoured @param types (`min?:`, `()=>`).
// Accuracy is the requirement; this generator is driven by the real exported surface.
//
// Run:  node scripts/api-appendix.mjs          (regenerates docs/api/ deterministically)
// Used by:  scripts/api-fitness.mjs            (no-diff + coverage guard; `npm run api-fitness`)
//
// Note: importing @onderling/item-types prints one ajv strict-mode warning line — harmless.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ROOT = resolve(new URL('..', import.meta.url).pathname);

export const WAVE1 = [
  'sdk', 'core', 'transports', 'vault', 'pod-client', 'redaction', 'pseudo-pod',
  'item-types', 'item-store', 'app-manifest', 'app-scaffold', 'attribute-charter',
  'logger', 'oidc-session', 'agent-registry',
];

// ── package.json helpers ─────────────────────────────────────────────────────

const pkgJsonCache = new Map();
function readPkgJson(name) {
  if (!pkgJsonCache.has(name)) {
    pkgJsonCache.set(name, JSON.parse(readFileSync(resolve(ROOT, 'packages', name, 'package.json'), 'utf8')));
  }
  return pkgJsonCache.get(name);
}

/** exports-map subpaths of a package, e.g. ['.', './sealing'] (falls back to main). */
function subpathsOf(name) {
  const pj = readPkgJson(name);
  if (pj.exports) return Object.keys(pj.exports);
  return ['.'];
}

/** Resolve '@onderling/<pkg>[/<sub>]' or a package (name, sub) pair to an absolute entry file. */
function resolveEntry(name, sub = '.') {
  const pj = readPkgJson(name);
  let target = null;
  if (pj.exports) {
    const entry = pj.exports[sub];
    target = typeof entry === 'string' ? entry : entry?.default ?? entry?.import ?? null;
  }
  if (!target && sub === '.') target = pj.main ?? 'index.js';
  if (!target) throw new Error(`no exports entry '${sub}' in @onderling/${name}`);
  return resolve(ROOT, 'packages', name, target);
}

/** Which wave-1 package (if any) a source file belongs to. */
function packageOfFile(file) {
  for (const name of WAVE1) {
    const dir = resolve(ROOT, 'packages', name) + '/';
    if (file.startsWith(dir)) return name;
  }
  return null;
}

// ── static module parsing ────────────────────────────────────────────────────

const stripLineComments = (s) => s.replace(/\/\/[^\n]*/g, '');

/** Read a balanced (...) group starting at `src[i] === '('`; returns { text, end } (text excludes outer parens). */
function readParens(src, i) {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return { text: src.slice(i + 1, j), end: j + 1 }; }
    else if (c === "'" || c === '"' || c === '`') { j = skipString(src, j); }
    else if (c === '/' && src[j + 1] === '/') { j = src.indexOf('\n', j); if (j < 0) break; }
    else if (c === '/' && src[j + 1] === '*') { j = src.indexOf('*/', j) + 1; }
  }
  return null;
}

/** Index of the closing quote of the string starting at src[i]. */
function skipString(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (q === '`' && src[j] === '$' && src[j + 1] === '{') {
      // skip ${...} interpolation (balanced braces, strings inside handled recursively)
      let depth = 0;
      for (let k = j + 1; k < src.length; k++) {
        if (src[k] === '{') depth++;
        else if (src[k] === '}') { depth--; if (!depth) { j = k; break; } }
        else if (src[k] === "'" || src[k] === '"' || src[k] === '`') k = skipString(src, k);
      }
      continue;
    }
    if (src[j] === q) return j;
  }
  return src.length;
}

/** Read a balanced {...} group starting at `src[i] === '{'` (strings/comments skipped). */
function readBraces(src, i) {
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return { text: src.slice(i + 1, j), end: j + 1 }; }
    else if (c === "'" || c === '"' || c === '`') { j = skipString(src, j); }
    else if (c === '/' && src[j + 1] === '/') { j = src.indexOf('\n', j); if (j < 0) break; }
    else if (c === '/' && src[j + 1] === '*') { j = src.indexOf('*/', j) + 1; }
  }
  return null;
}

/** The /** … *\/ block that immediately precedes `offset` (blank lines / line comments allowed between). */
function jsdocBefore(src, offset) {
  let s = src.slice(0, offset).replace(/\s+$/, '');
  // hop over trailing // line comments between the block and the declaration
  for (;;) {
    const nl = s.lastIndexOf('\n');
    const lastLine = s.slice(nl + 1).trim();
    if (lastLine.startsWith('//')) { s = s.slice(0, nl < 0 ? 0 : nl).replace(/\s+$/, ''); continue; }
    break;
  }
  if (!s.endsWith('*/')) return null;
  const start = s.lastIndexOf('/**');
  if (start < 0 || s.indexOf('*/', start) !== s.length - 2) return null;
  const block = s.slice(start, s.length);
  return block.startsWith('/***') ? null : block; // not a JSDoc block
}

const srcCache = new Map();
function readSource(file) {
  if (!srcCache.has(file)) srcCache.set(file, readFileSync(file, 'utf8'));
  return srcCache.get(file);
}

/**
 * Parse a module's column-0 export statements (this repo's barrels always write them at column 0;
 * string-embedded codegen like app-scaffold's is indented and therefore never matches).
 * Returns { locals: Map(name → decl), named: Map(name → {source, local}), stars: [source…], defaultsTo }.
 */
const moduleCache = new Map();
function parseModule(file) {
  if (moduleCache.has(file)) return moduleCache.get(file);
  const src = readSource(file);
  const locals = new Map();   // exported name → { offset (of declaration), declKind, localName }
  const named = new Map();    // exported name → { source, local }
  const stars = [];           // re-export-all sources, in order
  let defaultsTo = null;

  // export { A, B as C } [from 'spec']   (brace content may span lines and hold // comments)
  const braceRe = /^export\s*\{/gm;
  let m;
  while ((m = braceRe.exec(src))) {
    const open = m.index + m[0].length - 1;
    const grp = readBraces(src, open);
    if (!grp) continue;
    const after = src.slice(grp.end).match(/^\s*from\s*['"]([^'"]+)['"]/);
    const names = stripLineComments(grp.text).split(',').map((s) => s.trim()).filter(Boolean)
      .map((s) => { const [local, , exported] = s.split(/\s+(as)\s+/); return { local, exported: exported ?? local }; });
    for (const { local, exported } of names) {
      if (after) named.set(exported, { source: after[1], local });
      else locals.set(exported, { offset: null, declKind: null, localName: local });
    }
  }
  // export * from 'spec'
  const starRe = /^export\s*\*\s*from\s*['"]([^'"]+)['"]/gm;
  while ((m = starRe.exec(src))) stars.push(m[1]);
  // export [async] function|class|const|let|var NAME
  const declRe = /^export\s+(async\s+function|function\s*\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm;
  while ((m = declRe.exec(src))) {
    locals.set(m[2], { offset: m.index, declKind: m[1].replace(/\s+/g, ' ').trim(), localName: m[2] });
  }
  // export default IDENT
  const dm = src.match(/^export\s+default\s+([A-Za-z_$][\w$]*)\s*;?\s*$/m);
  if (dm) defaultsTo = dm[1];

  // resolve local `export { x }` names + defaultsTo to their declaration offsets
  const findDecl = (name) => {
    const re = new RegExp(`^(?:export\\s+)?(?:async\\s+)?(?:function\\s*\\*?|class|const|let|var)\\s+${name}\\b`, 'm');
    const mm = src.match(re);
    return mm ? { offset: mm.index, declKind: mm[0].match(/function|class|const|let|var/)[0], localName: name } : null;
  };
  for (const [exported, info] of locals) {
    if (info.offset === null) {
      const d = findDecl(info.localName);
      if (d) locals.set(exported, d);
    }
  }
  const parsed = { file, src, locals, named, stars, defaultsTo, findDecl };
  moduleCache.set(file, parsed);
  return parsed;
}

/** Resolve an import specifier relative to `fromFile` ('./x.js' or '@onderling/<pkg>[/<sub>]'). */
function resolveSpec(spec, fromFile) {
  if (spec.startsWith('.')) return resolve(dirname(fromFile), spec);
  const m = spec.match(/^@onderling\/([^/]+)(\/.+)?$/);
  if (m) return resolveEntry(m[1], m[2] ? `.${m[2]}` : '.');
  return null; // external dep — not followed
}

/** Walk re-export chains from `file` to the declaration of exported `name`. */
function resolveSymbol(file, name, seen = new Set()) {
  const key = `${file}::${name}`;
  if (seen.has(key)) return null;
  seen.add(key);
  const mod = parseModule(file);
  if (name === 'default' && mod.defaultsTo) {
    const local = mod.locals.get(mod.defaultsTo);
    if (local?.offset !== null && local?.offset !== undefined) return { file, ...local, aliasOf: mod.defaultsTo };
    const d = mod.findDecl(mod.defaultsTo);
    if (d) return { file, ...d, aliasOf: mod.defaultsTo };
  }
  if (mod.locals.has(name)) {
    const info = mod.locals.get(name);
    if (info.offset !== null) return { file, ...info };
    return null; // local export whose declaration we could not locate
  }
  if (mod.named.has(name)) {
    const { source, local } = mod.named.get(name);
    const target = resolveSpec(source, file);
    if (!target) return null;
    const r = resolveSymbol(target, local, seen);
    return r ? { ...r, renamedFrom: local !== name ? local : r.renamedFrom } : null;
  }
  for (const star of mod.stars) {
    const target = resolveSpec(star, file);
    if (!target) continue;
    const r = resolveSymbol(target, name, seen);
    if (r) return r;
  }
  return null;
}

// ── JSDoc parsing (pragmatic — types kept verbatim) ─────────────────────────

/** '{...}' balanced-brace type at the start of `s` → { type, rest }. */
function readTypeBrace(s) {
  if (!s.startsWith('{')) return { type: null, rest: s };
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') depth++;
    else if (s[i] === '}') { depth--; if (!depth) return { type: s.slice(1, i), rest: s.slice(i + 1) }; }
  }
  return { type: null, rest: s };
}

export function parseJsdoc(block) {
  if (!block) return null;
  const lines = block.replace(/^\/\*\*/, '').replace(/\*\/\s*$/, '')
    .split('\n').map((l) => l.replace(/^\s*\* ?/, ''));
  const chunks = []; // { tag: null | 'param' | ..., text }
  let cur = { tag: null, text: [] };
  for (const line of lines) {
    const t = line.match(/^@(\w+)\s*(.*)$/);
    if (t) { chunks.push(cur); cur = { tag: t[1], text: [t[2]] }; }
    else cur.text.push(line);
  }
  chunks.push(cur);
  const doc = { description: '', params: [], returns: null, deprecated: null };
  for (const c of chunks) {
    const text = c.text.join('\n').trim();
    if (c.tag === null) { if (text) doc.description = text; }
    else if (c.tag === 'param' || c.tag === 'arg' || c.tag === 'argument') {
      const { type, rest } = readTypeBrace(text);
      const nm = rest.trim().match(/^(\[?[\w$.]+(?:\s*=\s*[^\]]*)?\]?)\s*(?:[-—]\s*)?([\s\S]*)$/);
      doc.params.push({ type, name: nm ? nm[1] : rest.trim(), desc: nm ? nm[2].trim() : '' });
    } else if (c.tag === 'returns' || c.tag === 'return') {
      const { type, rest } = readTypeBrace(text);
      doc.returns = { type, desc: rest.replace(/^\s*[-—]\s*/, '').trim() };
    } else if (c.tag === 'deprecated') doc.deprecated = text || 'deprecated';
  }
  return doc;
}

// ── signature extraction ─────────────────────────────────────────────────────

const flat = (s) => s.replace(/\s+/g, ' ').trim();

/** Build a display signature for the declaration at `offset` in `file`. */
function extractSignature(file, offset, name, runtimeKind) {
  const src = readSource(file);
  const head = src.slice(offset, offset + 4000);
  // function declaration
  let m = head.match(/^(?:export\s+)?(async\s+)?function\s*(\*?)\s*[A-Za-z_$][\w$]*\s*/);
  if (m) {
    const p = readParens(src, offset + m[0].length);
    if (p) return { kind: 'function', signature: `${m[1] ? 'async ' : ''}${name}(${flat(p.text)})` };
  }
  // class declaration
  m = head.match(/^(?:export\s+)?class\s+[A-Za-z_$][\w$]*(\s+extends\s+[A-Za-z_$][\w$.]*)?/);
  if (m) {
    const ext = m[1] ? flat(m[1]) : '';
    const bodyOpen = src.indexOf('{', offset + m[0].length);
    let ctor = `new ${name}()`;
    if (bodyOpen > -1) {
      const body = readBraces(src, bodyOpen);
      if (body) {
        const cm = body.text.match(/(^|\n)\s*constructor\s*(?=\()/);
        if (cm) {
          const at = cm.index + cm[0].length;
          const p = readParens(body.text, at);
          if (p) ctor = `new ${name}(${flat(p.text)})`;
        }
      }
    }
    return { kind: 'class', signature: `class ${name}${ext ? ` ${ext}` : ''}`, ctor };
  }
  // const/let/var — arrow function or constant
  m = head.match(/^(?:export\s+)?(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(async\s+)?/);
  if (m) {
    const at = offset + m[0].length;
    if (src[at] === '(') {
      const p = readParens(src, at);
      if (p && /^\s*=>/.test(src.slice(p.end))) {
        return { kind: 'function', signature: `${m[1] ? 'async ' : ''}${name}(${flat(p.text)})` };
      }
    }
    const single = src.slice(at).match(/^([A-Za-z_$][\w$]*)\s*=>/);
    if (single) return { kind: 'function', signature: `${m[1] ? 'async ' : ''}${name}(${single[1]})` };
    return { kind: runtimeKind === 'function' ? 'function' : 'constant', signature: null };
  }
  return { kind: runtimeKind ?? 'constant', signature: null };
}

// ── runtime surface ──────────────────────────────────────────────────────────

async function runtimeExports(entryFile) {
  try {
    const mod = await import(pathToFileURL(entryFile).href);
    const out = new Map();
    for (const k of Object.keys(mod)) {
      const v = mod[k];
      let kind = 'constant';
      let methods = null;
      if (typeof v === 'function') {
        const s = Function.prototype.toString.call(v);
        if (/^class[\s{]/.test(s)) {
          kind = 'class';
          // descriptor-based: never touch prototype getters (they throw on private fields)
          const proto = v.prototype ?? {};
          methods = Object.getOwnPropertyNames(proto).filter((n) => {
            if (n === 'constructor') return false;
            const d = Object.getOwnPropertyDescriptor(proto, n);
            return typeof d?.value === 'function';
          });
        } else kind = 'function';
      } else if (v && typeof v === 'object') kind = 'object';
      out.set(k, { kind, methods });
    }
    return { ok: true, exports: out };
  } catch (e) {
    return { ok: false, error: e.message.split('\n')[0] };
  }
}

/** Static export-name list for entries that cannot be imported (e.g. core/conformance needs vitest). */
function staticExports(entryFile, seen = new Set()) {
  if (seen.has(entryFile)) return [];
  seen.add(entryFile);
  const mod = parseModule(entryFile);
  const names = new Set([...mod.locals.keys(), ...mod.named.keys()]);
  if (mod.defaultsTo) names.add('default');
  for (const star of mod.stars) {
    const t = resolveSpec(star, entryFile);
    if (t) for (const n of staticExports(t, seen)) names.add(n);
  }
  return [...names];
}

// ── analysis ─────────────────────────────────────────────────────────────────

/**
 * Analyse one package: union of all subpath exports, each resolved to its defining file,
 * JSDoc, kind and signature.
 */
export async function analysePackage(name) {
  const pj = readPkgJson(name);
  const subs = subpathsOf(name);
  const symbols = new Map(); // exported name → record
  const subpathNotes = new Map(); // sub → note (e.g. static analysis fallback)

  for (const sub of subs) {
    const entry = resolveEntry(name, sub);
    const rt = await runtimeExports(entry);
    let names;
    let kinds = new Map();
    if (rt.ok) {
      names = [...rt.exports.keys()];
      kinds = rt.exports;
    } else {
      names = staticExports(entry).sort();
      subpathNotes.set(sub, `could not be imported outside its peer context (${rt.error}); analysed statically`);
    }
    for (const exportName of names) {
      const spec = `@onderling/${name}${sub === '.' ? '' : sub.slice(1)}`;
      if (symbols.has(exportName)) { symbols.get(exportName).importFrom.push(spec); continue; }
      const resolved = resolveSymbol(entry, exportName);
      const rtInfo = kinds.get(exportName) ?? null;
      let rec = {
        name: exportName,
        importFrom: [spec],
        file: resolved?.file ?? null,
        originPkg: resolved ? packageOfFile(resolved.file) : null,
        aliasOf: resolved?.aliasOf ?? null,
        renamedFrom: resolved?.renamedFrom ?? null,
        kind: rtInfo?.kind === 'object' ? 'constant' : rtInfo?.kind ?? null,
        methods: rtInfo?.methods ?? null,
        signature: null,
        ctor: null,
        doc: null,
        declOffset: resolved?.offset ?? null,
      };
      if (resolved) {
        const sig = extractSignature(resolved.file, resolved.offset, resolved.localName ?? exportName, rec.kind);
        rec.kind = rec.kind === null || rec.kind === 'constant' || rec.kind === 'object'
          ? (sig.kind === 'constant' && rec.kind ? rec.kind : sig.kind)
          : rec.kind;
        rec.signature = sig.signature;
        rec.ctor = sig.ctor ?? null;
        rec.doc = parseJsdoc(jsdocBefore(readSource(resolved.file), resolved.offset));
      }
      symbols.set(exportName, rec);
    }
  }
  return { name, description: pj.description ?? '', version: pj.version, subs, subpathNotes, symbols };
}

export async function analyseAll() {
  const out = [];
  for (const name of WAVE1) out.push(await analysePackage(name));
  return out;
}

// ── rendering ────────────────────────────────────────────────────────────────

const GENERATED_NOTE =
  '> Generated by `node scripts/api-appendix.mjs` from the exported surface and source JSDoc.\n' +
  '> Do not edit by hand — edit the JSDoc in the source and regenerate. `npm run api-fitness` fails on drift.';

/** GitHub-style anchor slug for a `### \`name\`` heading. */
const anchor = (s) => s.toLowerCase().replace(/[^\w\- ]/g, '').replace(/ /g, '-');

function renderEntry(rec, pkgName) {
  const lines = [];
  lines.push(`### \`${rec.name}\``);
  lines.push('');
  const kindLabel = rec.kind ?? 'unknown';
  const importLine = rec.importFrom.map((s) => `\`'${s}'\``).join(', ');
  lines.push(`**Kind:** ${kindLabel} · **Import:** \`${rec.name}\` from ${importLine}`);
  lines.push('');
  if (rec.aliasOf) lines.push(`Default export — alias of \`${rec.aliasOf}\`.`, '');
  if (rec.renamedFrom) lines.push(`Defined as \`${rec.renamedFrom}\` in the source module.`, '');
  const sig = rec.kind === 'class'
    ? [rec.signature, rec.ctor].filter(Boolean).join('\n')
    : rec.signature;
  if (sig) lines.push('```js', sig, '```', '');
  if (rec.doc?.deprecated) lines.push(`**Deprecated:** ${rec.doc.deprecated}`, '');
  if (rec.doc?.description) lines.push(rec.doc.description, '');
  else lines.push('_No JSDoc block in the source (recorded gap — see the coverage table)._', '');
  if (rec.doc?.params?.length) {
    lines.push('**Parameters**', '');
    for (const p of rec.doc.params) {
      const type = p.type ? ` \`${flat(p.type)}\`` : '';
      lines.push(`- \`${p.name}\`${type}${p.desc ? ` — ${flat(p.desc)}` : ''}`);
    }
    lines.push('');
  }
  if (rec.doc?.returns && (rec.doc.returns.type || rec.doc.returns.desc)) {
    const type = rec.doc.returns.type ? `\`${flat(rec.doc.returns.type)}\`` : '';
    lines.push(`**Returns:** ${[type, flat(rec.doc.returns.desc ?? '')].filter(Boolean).join(' — ')}`, '');
  }
  if (rec.kind === 'class' && rec.methods?.length) {
    lines.push(`**Methods:** ${rec.methods.map((m) => `\`${m}()\``).join(' · ')}`, '');
  }
  return lines.join('\n');
}

export function renderPackage(model) {
  const { name, description, subs, subpathNotes, symbols } = model;
  const recs = [...symbols.values()];

  // package-own symbols grouped by defining module (source order); foreign ones grouped by origin package
  const own = recs.filter((r) => r.originPkg === name || r.originPkg === null);
  const foreign = recs.filter((r) => r.originPkg && r.originPkg !== name);

  const byModule = new Map();
  for (const r of own) {
    const key = r.file ? relative(resolve(ROOT, 'packages', name), r.file) : '(unresolved)';
    if (!byModule.has(key)) byModule.set(key, []);
    byModule.get(key).push(r);
  }
  for (const list of byModule.values()) list.sort((a, b) => (a.declOffset ?? 0) - (b.declOffset ?? 0));
  const moduleKeys = [...byModule.keys()].sort();

  const lines = [];
  lines.push(`# \`@onderling/${name}\` — API reference`, '');
  lines.push(GENERATED_NOTE, '');
  if (description) lines.push(description, '');
  lines.push(`README: [\`packages/${name}/README.md\`](../../packages/${name}/README.md) · Index: [docs/api/README.md](README.md)`, '');
  if (subs.length > 1) {
    lines.push('**Entry points**', '');
    for (const sub of subs) {
      const spec = `@onderling/${name}${sub === '.' ? '' : sub.slice(1)}`;
      const note = subpathNotes.get(sub) ? ` — ${subpathNotes.get(sub)}` : '';
      lines.push(`- \`'${spec}'\`${note}`);
    }
    lines.push('');
  } else if (subpathNotes.get('.')) {
    lines.push(`_Note: the entry ${subpathNotes.get('.')}._`, '');
  }

  if (foreign.length) {
    lines.push('## Re-exported surface', '');
    lines.push(`These exports are re-exported verbatim from other \`@onderling/*\` packages; each links to its canonical reference entry.`, '');
    const byOrigin = new Map();
    for (const r of foreign) {
      if (!byOrigin.has(r.originPkg)) byOrigin.set(r.originPkg, []);
      byOrigin.get(r.originPkg).push(r);
    }
    for (const origin of WAVE1.filter((p) => byOrigin.has(p))) {
      const list = byOrigin.get(origin).sort((a, b) => a.name.localeCompare(b.name));
      lines.push(`### From \`@onderling/${origin}\``, '');
      lines.push('| Export | Kind | Reference |', '| --- | --- | --- |');
      for (const r of list) {
        lines.push(`| \`${r.name}\` | ${r.kind ?? '—'} | [\`${origin}.md\`](${origin}.md#${anchor(r.name)}) |`);
      }
      lines.push('');
    }
  }

  if (own.length) {
    if (foreign.length) lines.push(`## Package-defined surface`, '');
    for (const key of moduleKeys) {
      if (moduleKeys.length > 1 || foreign.length) lines.push(`## \`${key}\``, '');
      for (const r of byModule.get(key)) lines.push(renderEntry(r, name), '');
    }
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function coverage(model) {
  const recs = [...model.symbols.values()];
  const total = recs.length;
  const documented = recs.filter((r) => r.doc?.description).length;
  const gaps = recs.filter((r) => !r.doc?.description).map((r) => r.name).sort();
  return { total, documented, gaps };
}

export function renderIndex(models) {
  const lines = [];
  lines.push('# API reference — the published packages', '');
  lines.push(GENERATED_NOTE, '');
  lines.push('Per-function reference for every wave-1 `@onderling/*` package: every public export');
  lines.push('(what each package entry point actually exports at runtime), its kind, signature, and');
  lines.push('JSDoc description. Symbols one package re-exports from another appear once, in the');
  lines.push('defining package\'s file, and are link-tabled from the re-exporting package.', '');
  lines.push('Kept honest three ways: `npm run readme-fitness` (README symbols exist in the code),');
  lines.push('`npm run api-fitness` (JSDoc coverage cannot regress + these files cannot drift from');
  lines.push('the source — regeneration must produce no diff), and the executable journeys in');
  lines.push('[`apps/sdk-journeys/`](../../apps/sdk-journeys/).', '');
  lines.push('## Coverage', '');
  lines.push('JSDoc coverage of the public surface (documented exports / total public exports).');
  lines.push('Recorded gaps are allowlisted in `scripts/api-doc-gaps.json`; new undocumented exports fail `api-fitness`.', '');
  lines.push('| Package | Reference | Public exports | Documented | Coverage | Recorded gaps |');
  lines.push('| --- | --- | ---: | ---: | ---: | --- |');
  for (const model of models) {
    const { total, documented, gaps } = coverage(model);
    const pct = total ? Math.round((documented / total) * 100) : 100;
    const gapText = gaps.length
      ? gaps.slice(0, 6).map((g) => `\`${g}\``).join(', ') + (gaps.length > 6 ? ` … (${gaps.length} total)` : '')
      : '—';
    lines.push(`| \`@onderling/${model.name}\` | [${model.name}.md](${model.name}.md) | ${total} | ${documented} | ${pct}% | ${gapText} |`);
  }
  lines.push('');
  return lines.join('\n');
}

// ── main ─────────────────────────────────────────────────────────────────────

export async function generateAll() {
  const models = await analyseAll();
  const files = new Map(); // relative path under docs/api → content
  for (const model of models) files.set(`${model.name}.md`, renderPackage(model));
  files.set('README.md', renderIndex(models));
  return { models, files };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const { models, files } = await generateAll();
  const outDir = resolve(ROOT, 'docs', 'api');
  mkdirSync(outDir, { recursive: true });
  for (const [rel, content] of files) writeFileSync(resolve(outDir, rel), content);
  let unresolved = 0;
  for (const model of models) {
    const { total, documented, gaps } = coverage(model);
    for (const r of model.symbols.values()) if (!r.file) { unresolved++; console.error(`  unresolved: ${model.name} → ${r.name}`); }
    console.log(`${model.name.padEnd(18)} ${documented}/${total} documented${gaps.length ? ` (gaps: ${gaps.length})` : ''}`);
  }
  console.log(`\nWrote ${files.size} file(s) to docs/api/.`);
  if (unresolved) console.error(`${unresolved} export(s) could not be statically resolved — their entries lack source detail.`);
}
