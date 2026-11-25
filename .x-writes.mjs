// For every key/prefix row: its write sites, each 'raw' (a setItem not on kv./sealed.) or 'kv' (through a sealed store).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { STORAGE } from './apps/basis/src/v2/storageRegister.js';
const ROOTS = ['apps/basis/web', 'apps/basis/src', 'apps/basis/bin', 'apps/basis-mobile/src', 'apps/basis-mobile/App.js'];
const files = [];
const walk = (rel) => { let st; try { st = statSync(rel); } catch { return; } if (st.isFile()) { if (/\.(m?js)$/.test(rel) && !/\.test\.|\.spec\./.test(rel)) files.push(rel); return; } for (const n of readdirSync(rel)) { if (['node_modules', 'test', 'dist'].includes(n) || n.startsWith('.')) continue; walk(`${rel}/${n}`); } };
for (const r of ROOTS) walk(r);
const out = new Map(Object.keys(STORAGE).map((id) => [id, []]));
for (const f of files) {
  if (f.endsWith('storageRegister.js')) continue;
  const text = readFileSync(f, 'utf8');
  const consts = new Map();
  for (const m of text.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*[^;\n]*storageName\('([A-Za-z0-9_]+)'\)/g)) consts.set(m[1], m[2]);
  text.split('\n').forEach((l, i) => {
    if (/^\s*(\/\/|\*)/.test(l)) return;
    const ids = [...l.matchAll(/storageName\('([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]);
    for (const [c, id] of consts) if (new RegExp(`\\b${c}\\b`).test(l) && !l.includes(`const ${c}`)) ids.push(id);
    if (!ids.length) return;
    let how = null;
    if (/\b(?:kv|sealed)\.setItem\s*\(/.test(l)) how = 'kv';
    else if (/\.setItem\s*\??\.?\s*\(/.test(l)) how = 'raw';
    else if (/\bsealedKeyValue\s*\(|\bsealedJsonIo\s*\(|\bsealedLocalBackend\s*\(|\bsealedPersist\s*\(|\bsealedLocalVault\s*\(/.test(l)) how = 'sealed-builder';
    else if (/\bjsonKv\s*\(|\bplainKeyValue\s*\(/.test(l)) how = 'twin';
    else how = 'use';
    for (const id of new Set(ids)) out.get(id).push(`${how} ${f.replace('apps/basis/', 'b/').replace('apps/basis-mobile/', 'm/')}:${i + 1}`);
  });
}
for (const [id, r] of Object.entries(STORAGE)) {
  if (r.kind === 'store' || r.kind === 'vault') continue;
  const ws = out.get(id);
  const raw = ws.filter((w) => w.startsWith('raw'));
  const tag = raw.length ? 'RAW ' : (ws.some((w) => /^(kv|sealed-builder)/.test(w)) ? 'SEAL' : '??  ');
  console.log(`${tag} ${id.padEnd(22)} ${ws.filter((w) => !w.startsWith('use')).slice(0, 3).join(' | ') || ws.slice(0, 2).join(' | ')}`);
}
