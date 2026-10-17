/**
 * Browser-safe shim for `node:path`.
 *
 * Aliased via vite.config.js → resolve.alias.  Static `import { join,
 * dirname, ... } from 'node:path'` statements come from sync-engine
 * (PathMap, scanLocal, versions), pseudo-pod (NodeFsBackend),
 * tasks-v0 + pinboard FilePersist, folio CLI/server, archive Db.
 *
 * Unlike `fs.js` and `crypto.js`, this stub is a REAL implementation —
 * path manipulation is pure string operations with no I/O, so we can
 * answer correctly without ever needing platform access.  Some browser
 * callers may legitimately compute a path string (e.g. sync-engine's
 * PathMap normalises POSIX paths for the wire format), and silently
 * working > silently throwing.
 *
 * POSIX-style only (forward-slash separators, colon path delimiter).
 * Matches the existing Linux/macOS development convention.  The Windows
 * adapter path is Node-only; the browser bundle never sees it.
 *
 * Real impl (not throw-stub) is safe because it's no-IO; sync-engine
 * legitimately calls path ops on wire-format strings in the browser.
 */

export const sep        = '/';
export const delimiter  = ':';

/** Normalise consecutive slashes and trailing slash (POSIX). */
function _normalize(p) {
  if (!p) return '';
  // Preserve leading '/' or '//' (POSIX significant double-slash); collapse the rest.
  const leading = p.startsWith('//') ? '//' : (p.startsWith('/') ? '/' : '');
  const body = p.slice(leading.length).replace(/\/+/g, '/').replace(/\/$/, '');
  return leading + body || (leading || '.');
}

export const normalize = (p) => {
  const out = _normalize(String(p ?? ''));
  return out === '' ? '.' : out;
};

export const join = (...parts) => {
  const filtered = parts
    .map(x => x == null ? '' : String(x))
    .filter(Boolean);
  if (filtered.length === 0) return '.';
  return _normalize(filtered.join('/')) || '.';
};

export const dirname = (p) => {
  const s = String(p ?? '');
  if (s === '') return '.';
  // Strip trailing slashes (except leading).
  const trimmed = s.replace(/\/+$/, '') || s[0];
  const i = trimmed.lastIndexOf('/');
  if (i === -1) return '.';
  if (i === 0)  return '/';
  return trimmed.slice(0, i);
};

export const basename = (p, ext) => {
  const s = String(p ?? '').replace(/\/+$/, '');
  const i = s.lastIndexOf('/');
  const tail = i === -1 ? s : s.slice(i + 1);
  if (ext && typeof ext === 'string' && tail.endsWith(ext) && tail !== ext) {
    return tail.slice(0, -ext.length);
  }
  return tail;
};

export const extname = (p) => {
  const b = basename(String(p ?? ''));
  // Hidden files (leading dot, no other dots) have no extension.
  const dot = b.lastIndexOf('.');
  if (dot <= 0) return '';
  return b.slice(dot);
};

export const isAbsolute = (p) => String(p ?? '').startsWith('/');

/** POSIX resolve — walks .. and . segments; returns absolute path. */
export const resolve = (...parts) => {
  // Start from "/" if no absolute path is found (browser has no cwd).
  let resolved = '';
  let absolute = false;
  for (let i = parts.length - 1; i >= 0 && !absolute; i--) {
    const p = parts[i];
    if (p == null || p === '') continue;
    resolved = String(p) + '/' + resolved;
    absolute = isAbsolute(String(p));
  }
  if (!absolute) resolved = '/' + resolved;

  // Normalise segments: collapse '.', resolve '..'.
  const segs = resolved.split('/');
  const out = [];
  for (const seg of segs) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') { out.pop(); continue; }
    out.push(seg);
  }
  return '/' + out.join('/');
};

export const relative = (from, to) => {
  const a = resolve(from).split('/').filter(Boolean);
  const b = resolve(to).split('/').filter(Boolean);
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  const up = a.slice(i).map(() => '..');
  const down = b.slice(i);
  return [...up, ...down].join('/') || '';
};

export const parse = (p) => {
  const s = String(p ?? '');
  const root = isAbsolute(s) ? '/' : '';
  const dir  = dirname(s);
  const base = basename(s);
  const ext  = extname(base);
  const name = ext ? base.slice(0, -ext.length) : base;
  return { root, dir, base, ext, name };
};

export const format = (obj) => {
  if (!obj || typeof obj !== 'object') return '';
  const dir = obj.dir || obj.root || '';
  const base = obj.base || ((obj.name || '') + (obj.ext || ''));
  if (!dir) return base;
  if (dir === '/') return '/' + base;
  return dir + '/' + base;
};

// `posix` and `win32` namespaces — node:path exposes these for cross-
// platform-aware code.  Browser bundle is always POSIX; alias `posix`
// to the module itself and `win32` to a throw-stub (no browser caller
// should hit win32).
const _self = { sep, delimiter, normalize, join, dirname, basename,
                extname, isAbsolute, resolve, relative, parse, format };
export const posix = _self;
export const win32 = new Proxy({}, {
  get(_t, name) {
    throw new Error(`[node:path.win32.${String(name)}] not available in the browser`);
  },
});

export default { ..._self, posix, win32 };
