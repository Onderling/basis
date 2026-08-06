#!/usr/bin/env node
/**
 * guard-index.mjs — generate the DESIGNED-VS-BUILT map from the guards themselves.
 *
 * Every guard is one machine-checked design claim ("one store per circle", "one retention table"). The map of
 * what the system is DESIGNED to be — and whether the code matches — is therefore just the index of the
 * guards. A prose "what's built yet" note drifts (that is how a stale "being completed" misled a build on
 * 2026-08-06); a guard cannot — it runs. So this reads the guards and writes `docs/guards.md`.
 *
 *   node scripts/guard-index.mjs           → write docs/guards.md (the structural index; no live status)
 *   node scripts/guard-index.mjs --check   → exit 1 if docs/guards.md is stale (the fitness check)
 *   node scripts/guard-index.mjs --status  → run each script guard and print live green/red (the /health seed)
 *
 * Two tiers: TIER-1 script guards (`scripts/lint-*.mjs`, run by `npm run guards`) — claim from the docstring,
 * live status runnable; and NAMED design guards (`G-*`, embedded in fitness tests) — claim from the `describe`
 * block. The named tier is best-effort (a guard with no `G-*` id and no describe mention won't appear — the
 * fix is a `@guard` docstring convention, a later step).
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const OUT = path.join(ROOT, 'docs', 'guards.md');

/** Tier-1: scripts/lint-*.mjs. Extract each guard's `{id?, claim}` from its docstring header. */
function scriptGuards() {
  return readdirSync(HERE)
    .filter((f) => /^lint-.*\.mjs$/.test(f) && !f.endsWith('.test.mjs'))
    .sort()
    .map((f) => {
      const base = f.replace(/\.mjs$/, '');
      const { id, claim } = guardMeta(readFileSync(path.join(HERE, f), 'utf8'), base);
      return { name: base.replace(/^lint-/, ''), file: `scripts/${f}`, id, claim };
    });
}

/** Pull `{id?, claim}` from a guard's header (first ~14 comment lines), tolerant of the three styles used:
 *  `lint-x (G-C1) — claim` · `lint-x.mjs — claim` · `Fitness guard: claim`. */
function guardMeta(src, base) {
  const head = src.split('\n').slice(0, 14)
    .map((l) => l.replace(/^\s*(\/\*\*|\*\/|\*|\/\/)\s?/, '').trim())
    .filter(Boolean);
  const trim = (s) => {
    let c = (s ?? '').trim();
    c = c.replace(/[:.]$/, '');
    return c.length > 110 ? `${c.slice(0, 107)}…` : c;
  };
  const nameRe = new RegExp(`^${base.replace(/[-.]/g, '\\$&')}(?:\\.mjs)?\\s*(?:\\((G-[A-Za-z0-9-]+)\\))?\\s*[—-]\\s*(.+)`);
  for (const l of head) {
    const m = l.match(nameRe);
    if (m) return { id: m[1] ?? null, claim: trim(m[2].replace(/,?\s+(structurally|and now also).*$/i, '')) };
    const fm = l.match(/^Fitness (?:guard|function)\s*[:—-]?\s*(.+)/i);
    if (fm && !/^(for|function)\b/i.test(fm[1])) return { id: null, claim: trim(fm[1]) };
  }
  // Fallback: the first real sentence that is not the bare title.
  for (const l of head) {
    if (/^lint-/.test(l) || l.startsWith(base)) continue;
    if (/^[A-Za-z]/.test(l) && l.length > 20) return { id: null, claim: trim(l.replace(/\s+—\s+.*$/, m => m).replace(/\s*\(.*$/, '')) };
  }
  return { id: null, claim: '—' };
}

/** Recursively find test files under apps/ + packages/. */
function testFiles() {
  const out = [];
  const skip = new Set(['node_modules', 'dist', 'build', '.git', '_archive', 'coverage']);
  const walk = (dir) => {
    let names; try { names = readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (skip.has(n)) continue;
      const full = path.join(dir, n);
      let st; try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) walk(full);
      else if (/\.test\.(js|mjs)$/.test(n)) out.push(full);
    }
  };
  for (const d of ['apps', 'packages']) walk(path.join(ROOT, d));
  return out;
}

/** Named design guards: `G-*` ids that appear in a `describe(...)` string. Claim = that string. */
function namedGuards() {
  const byId = new Map();
  const idRe = /\bG-[A-Z][A-Za-z0-9-]*\b/g;
  for (const file of testFiles()) {
    let src; try { src = readFileSync(file, 'utf8'); } catch { continue; }
    const rel = path.relative(ROOT, file);
    for (const dm of src.matchAll(/describe\(\s*(['"`])([\s\S]*?)\1/g)) {
      const text = dm[2].replace(/\s+/g, ' ').trim();
      for (const im of text.matchAll(idRe)) {
        const id = im[0];
        if (!byId.has(id)) byId.set(id, { id, claim: cleanClaim(text, id), file: rel });
      }
    }
  }
  return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Trim a describe string to the CLAIM: drop the id + a leading separator, cap length. */
function cleanClaim(text, id) {
  let c = text.replace(id, '').replace(/^[\s—:·(),-]+/, '').trim();
  c = c.replace(/^(the|—)\s+/i, '').trim();
  return (c.length > 120 ? `${c.slice(0, 117)}…` : c) || text;
}

function render(scripts, named) {
  const L = [];
  L.push('# Guards — the designed-vs-built map');
  L.push('');
  L.push('> Generated by `scripts/guard-index.mjs` (`npm run guard-index`). Do not edit by hand — a fitness test');
  L.push('> keeps it in sync with the actual guards. Live green/red: `node scripts/guard-index.mjs --status` or');
  L.push('> `npm run guards`.');
  L.push('');
  L.push('Every guard is one machine-checked **design claim**. This index IS the map of what the system is');
  L.push('designed to be — a claim without a guard is exactly where the code silently drifts from the design.');
  L.push('');
  L.push(`## Tier-1 — script guards (\`scripts/lint-*.mjs\`, run by \`npm run guards\`) · ${scripts.length}`);
  L.push('');
  L.push('| Guard | Id | Pins (the design claim) |');
  L.push('|---|---|---|');
  for (const g of scripts) L.push(`| \`${g.name}\` | ${g.id ?? '—'} | ${g.claim} |`);
  L.push('');
  L.push(`## Named design guards (\`G-*\`, in fitness tests) · ${named.length}`);
  L.push('');
  L.push('*Best-effort — discovered from `describe(...)` blocks. A guard with no `G-*` id will not appear here.*');
  L.push('');
  L.push('| Id | Claim | Where |');
  L.push('|---|---|---|');
  for (const g of named) L.push(`| ${g.id} | ${g.claim} | \`${g.file}\` |`);
  L.push('');
  return L.join('\n');
}

function generate() {
  return render(scriptGuards(), namedGuards());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes('--status')) {
    let red = 0;
    console.log('── guard status ───────────────────────────────');
    for (const g of scriptGuards()) {
      const r = spawnSync(process.execPath, [path.join(ROOT, g.file)], { cwd: ROOT, encoding: 'utf8' });
      const ok = r.status === 0;
      if (!ok) red++;
      console.log(` ${ok ? '✓' : '✗'} ${g.name.padEnd(22)} ${g.claim}`);
    }
    console.log(`──────────────────────────── ${scriptGuards().length - red}/${scriptGuards().length} green ──`);
    process.exit(red ? 1 : 0);
  }
  const generated = generate();
  if (args.includes('--check')) {
    let committed = ''; try { committed = readFileSync(OUT, 'utf8'); } catch { /* missing → stale */ }
    if (committed.trim() !== generated.trim()) {
      console.error('✗ docs/guards.md is stale — run `npm run guard-index` and commit.');
      process.exit(1);
    }
    console.log('✓ docs/guards.md is fresh.');
  } else {
    writeFileSync(OUT, generated);
    console.log(`✓ wrote docs/guards.md (${scriptGuards().length} script guards, ${namedGuards().length} named).`);
  }
}

export { generate, scriptGuards, namedGuards, cleanClaim };
