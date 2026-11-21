/**
 * toolboxPages — a toolbox's own page, served from the box itself, to the people of the household only.
 *
 * The box's operator may place a toolbox's page as static files beside its placed file:
 * `<data-dir>/toolboxes/<name>/page/` (an `index.html` and what it loads). The box then serves those files, and
 * nothing else, on LOCALHOST ONLY (127.0.0.1): what reaches it from the home network is the operator's https server in
 * front, which holds the certificate. The listener is open only while a toolbox with such a page is ON.
 *
 * Who gets in. `/scherm <toolbox>` hands the person, in their own private chat, the page's link with an ENTRY in its
 * query (`?e=`), beside the pairing ticket in its fragment (never sent to a server). The page server answers three ways:
 *   - a live entry for THIS toolbox, of a person who may still use it: the entry is spent (one use, whatever happens)
 *     and the browser gets a cookie for this toolbox's path only (`HttpOnly; Secure; SameSite=Strict`), then a
 *     redirect to the same address without the entry;
 *   - a live cookie for this toolbox, of a person who may still use it: the page's files;
 *   - anything else: a refusal page, in words, that says to ask the bot for a link.
 * Entries and cookies are rows in a store of the box (sealed, as its other stores), keyed to the person: a person who
 * leaves the household loses them, and every request asks again whether the person may still use the toolbox.
 * The entry and the cookie only decide who may load the page's FILES; they grant nothing: the page gets data only
 * through its paired grant.
 *
 * What is never done: a directory listing, a file outside the page folder (by `..`, an encoded slash, a dot file or a
 * symbolic link out of it), a type not in the fixed list, a request body read, a secret in a log line. A secret is
 * kept only as its hash and compared in constant time.
 * Pure composition: the store, the toolboxes and the person check are handed in.
 */
import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';
import { SCREEN_PAIRING_TTL_MS } from './screenDoor.js';

/** The localhost port the box serves toolbox pages on (the https server in front forwards to it). */
export const TOOLBOX_PAGE_PORT = param({ key: 'tools.pagePort', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 8790 });
/** How long a page's cookie lets that browser in (this device, this toolbox), unless the person leaves first. */
export const TOOLBOX_PAGE_COOKIE_MS = param({ key: 'tools.pageCookieMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30 * 86_400_000 });
/**
 * How long an entry can be spent: the life of the pairing ticket it is made beside, so the link has ONE life (both
 * halves are read from the same constant, and a test pins that they agree).
 */
export const TOOLBOX_PAGE_ENTRY_MS = SCREEN_PAIRING_TTL_MS;

/** Only ever this address: the box opens no port on the network for a page. */
const LOCALHOST = '127.0.0.1';
const COOKIE = 'onderling-page';
const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const TOKEN = /^([A-Za-z0-9_-]{12})\.([A-Za-z0-9_-]{43})$/;
/** A file name the page server serves: no dot first (no `..`, no dot files), nothing but plain characters. */
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;
/** The fixed content types: a file of any other kind is not served. */
const TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
});
/** On every answer: nothing sniffed, nothing framed, no address handed on, nothing kept past the cookie. */
const BASE_HEADERS = Object.freeze({
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY', 'Content-Security-Policy': "frame-ancestors 'none'",
});

const sha256 = (s) => createHash('sha256').update(String(s)).digest();
const sameHash = (hex, secret) => {
  const want = Buffer.from(String(hex ?? ''), 'hex');
  const got = sha256(secret);
  return want.length === got.length && timingSafeEqual(want, got);
};
const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * The box's store of page entries and page cookies: one sealed key-value row set, each row `{kind, person, toolbox,
 * hash, until}` under a random id; the secret half of a token is kept only as its hash.
 * @param {{store: {get: (k: string) => Promise<string|null>, set: (k: string, v: string) => Promise<void>}, now?: () => number}} a
 */
export function createPageEntries({ store, now = Date.now }) {
  const KEY = 'rows';
  let chain = Promise.resolve();
  const locked = (fn) => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
  const read = async () => {
    try { const v = JSON.parse((await store.get(KEY)) ?? '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; }
  };
  const write = (rows) => store.set(KEY, JSON.stringify(rows));
  const prune = (rows) => { const t = now(); for (const [id, r] of Object.entries(rows)) if (!(Number(r?.until) > t)) delete rows[id]; return rows; };
  const issue = (kind, person, toolbox, ms) => locked(async () => {
    const id = randomBytes(9).toString('base64url');
    const secret = randomBytes(32).toString('base64url');
    const rows = prune(await read());
    rows[id] = { kind, person: String(person), toolbox: String(toolbox), hash: sha256(secret).toString('hex'), until: now() + ms };
    await write(rows);
    return `${id}.${secret}`;
  });
  /** The row a token names, checked: its kind, its toolbox, its life, its secret. `spend` removes it whatever the outcome. */
  const check = (kind, token, toolbox, { spend = false } = {}) => locked(async () => {
    const m = TOKEN.exec(String(token ?? ''));
    if (!m) return { ok: false, reason: `${kind}-unknown` };
    const rows = await read();
    const row = Object.hasOwn(rows, m[1]) ? rows[m[1]] : null;
    if (!row || row.kind !== kind || !sameHash(row.hash, m[2])) return { ok: false, reason: `${kind}-unknown` };
    if (spend) { delete rows[m[1]]; await write(prune(rows)); }
    if (!(Number(row.until) > now())) return { ok: false, reason: `${kind}-expired` };
    if (row.toolbox !== toolbox) return { ok: false, reason: `${kind}-other-toolbox` };
    return { ok: true, person: row.person };
  });
  const dropWhere = (pred) => locked(async () => {
    const rows = await read();
    let n = 0;
    for (const [id, r] of Object.entries(rows)) if (pred(r)) { delete rows[id]; n += 1; }
    if (n) await write(prune(rows));
    return n;
  });
  return {
    /** A fresh entry for this person and toolbox: one use, as short-lived as the pairing ticket. */
    mintEntry: (person, toolbox) => issue('entry', person, toolbox, TOOLBOX_PAGE_ENTRY_MS),
    /** Spend an entry (gone whatever the answer): `{ok, person}` when it was live and for this toolbox. */
    spendEntry: (token, toolbox) => check('entry', token, toolbox, { spend: true }),
    /** A cookie for this person and toolbox, for this browser. */
    issueCookie: (person, toolbox) => issue('cookie', person, toolbox, TOOLBOX_PAGE_COOKIE_MS),
    /** A cookie's person, when it is live and for this toolbox. */
    cookie: (token, toolbox) => check('cookie', token, toolbox),
    /** A person who left: every entry and cookie of theirs is gone. */
    dropPerson: (person) => dropWhere((r) => r?.person === String(person)),
    /** Every row of a toolbox not in `names` (switched off, or its page gone) is gone. */
    keepOnly: (names) => { const keep = new Set(names); return dropWhere((r) => !keep.has(r?.toolbox)); },
  };
}

/** The cookie values a request carries under the page cookie's name. */
function cookiesOf(req) {
  return String(req.headers.cookie ?? '').split(';').map((c) => c.trim()).filter((c) => c.startsWith(`${COOKIE}=`)).map((c) => c.slice(COOKIE.length + 1));
}

/** The person's language for the refusal page, from what the browser asks for: English when it asks for that first. */
function langOf(req) {
  return /^\s*en\b/i.test(String(req.headers['accept-language'] ?? '')) ? 'en' : 'nl';
}

/**
 * @param {object} a
 * @param {ReturnType<typeof createPageEntries>} a.entries
 * @param {string} a.pagesDir   the placed toolboxes' folder (`<data-dir>/toolboxes`); a page is `<pagesDir>/<name>/page/`
 * @param {() => Promise<string[]>} a.onToolboxes   the names of the toolboxes ON now
 * @param {(name: string) => Promise<{page: string}|null>} a.pageOf   an ON toolbox's placed page, or null
 * @param {(person: string, toolbox: string) => Promise<boolean>} a.mayEnter   the person is in the household and their
 *   role may use this toolbox (asked on every request)
 * @param {(key: string, params?: object, lang?: string) => string} a.t
 * @param {number} [a.port]
 * @param {(e: object) => void} [a.log]   codes only: never a token, a cookie or a query
 */
export function createToolboxPages({ entries, pagesDir, onToolboxes, pageOf, mayEnter, t, port = TOOLBOX_PAGE_PORT, log = () => {} }) {
  let server = null;
  const pageDirOf = (name) => path.join(pagesDir, name, 'page');
  const hasPageDir = async (name) => { try { return (await stat(pageDirOf(name))).isDirectory(); } catch { return false; } };
  /** Does the box serve this toolbox's page now: a good name, ON with a placed page, and its page folder there. */
  const serves = async (name) => {
    if (!NAME.test(String(name ?? ''))) return false;
    try { if (!(await pageOf(name))) return false; } catch { return false; }
    return hasPageDir(name);
  };
  const allowed = async (person, name) => { try { return Boolean(await mayEnter(person, name)); } catch { return false; } };

  const send = (req, res, status, headers, body) => {
    res.writeHead(status, { ...BASE_HEADERS, ...headers, ...(body != null ? { 'Content-Length': Buffer.byteLength(body) } : {}) });
    res.end(req.method === 'HEAD' ? undefined : body);
  };
  const page = (req, res, status, titleKey, bodyKey, params = {}) => {
    const lang = langOf(req);
    const title = escapeHtml(t(titleKey, params, lang));
    const body = escapeHtml(t(bodyKey, params, lang));
    send(req, res, status, { 'Content-Type': 'text/html; charset=utf-8' },
      `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><h1>${title}</h1><p>${body}</p></body></html>`);
  };
  const refuse = (req, res, toolbox) => page(req, res, 403, 'circle.bot.toolbox_page_refused_title', 'circle.bot.toolbox_page_refused_body', { toolbox });
  const notFound = (req, res) => page(req, res, 404, 'circle.bot.toolbox_page_not_found_title', 'circle.bot.toolbox_page_not_found_body');

  /** A file of the page folder, or a not-found: never a listing, never a file outside it, never a type not listed. */
  async function serveFile(req, res, name, rest) {
    const wanted = rest.endsWith('/') ? `${rest}index.html` : rest;
    let segs;
    try { segs = wanted.slice(1).split('/').map((s) => decodeURIComponent(s)); } catch { return notFound(req, res); }
    if (!segs.length || !segs.every((s) => SEGMENT.test(s))) return notFound(req, res);
    const type = TYPES[path.extname(segs.at(-1)).toLowerCase()];
    if (!type) return notFound(req, res);
    let file; let root;
    try { root = await realpath(pageDirOf(name)); file = await realpath(path.join(pageDirOf(name), ...segs)); } catch { return notFound(req, res); }
    // a symbolic link that leads out of the page folder is not followed out of it
    if (!file.startsWith(root + path.sep)) { log({ what: 'refused', toolbox: name, reason: 'outside-page' }); return notFound(req, res); }
    let bytes;
    try { if (!(await stat(file)).isFile()) return notFound(req, res); bytes = await readFile(file); } catch { return notFound(req, res); }
    res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': type, 'Content-Length': bytes.length });
    res.end(req.method === 'HEAD' ? undefined : bytes);
    return undefined;
  }

  async function handle(req, res) {
    // a page is read, never written to: no other method, and no request body is read
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { ...BASE_HEADERS, Allow: 'GET, HEAD', 'Content-Length': 0 }); res.end(); return; }
    let url;
    try { url = new URL(String(req.url ?? '/'), 'http://page.invalid'); } catch { notFound(req, res); return; }
    const m = /^\/([a-z][a-z0-9-]{0,31})(\/.*)?$/.exec(url.pathname);
    if (!m) { notFound(req, res); return; }
    const name = m[1];
    if (!(await serves(name))) { refuse(req, res, name); return; }
    // the toolbox's own path, with the slash its cookie is scoped to
    if (!m[2]) { send(req, res, 308, { Location: `/${name}/${url.search}` }, ''); return; }
    const rest = m[2];
    // 1. a cookie of this browser, for this toolbox, of a person who may still use it: the files
    for (const c of cookiesOf(req)) {
      const r = await entries.cookie(c, name);
      if (r.ok && await allowed(r.person, name)) { await serveFile(req, res, name, rest); return; }
      if (r.ok) { log({ what: 'refused', toolbox: name, reason: 'not-allowed' }); refuse(req, res, name); return; }
    }
    // 2. an entry from the link the bot sent: spent now, and this browser gets the cookie instead
    const entry = url.searchParams.get('e');
    if (entry) {
      const r = await entries.spendEntry(entry, name);
      if (!r.ok) { log({ what: 'refused', toolbox: name, reason: r.reason }); refuse(req, res, name); return; }
      if (!(await allowed(r.person, name))) { log({ what: 'refused', toolbox: name, reason: 'not-allowed' }); refuse(req, res, name); return; }
      const cookie = await entries.issueCookie(r.person, name);
      const attrs = `Path=/${name}/; Max-Age=${Math.floor(TOOLBOX_PAGE_COOKIE_MS / 1000)}; HttpOnly; Secure; SameSite=Strict`;
      log({ what: 'entered', toolbox: name });
      // the same address without the entry (the fragment, with the pairing ticket, stays in the browser)
      send(req, res, 303, { Location: `/${name}${rest}`, 'Set-Cookie': `${COOKIE}=${cookie}; ${attrs}` }, '');
      return;
    }
    // 3. nothing that lets this browser in
    refuse(req, res, name);
  }

  let syncing = Promise.resolve();
  return {
    /** The entry for the link `/scherm <toolbox>` sends, or null when the box does not serve that toolbox's page. */
    async entryFor(person, toolbox) {
      if (!(await serves(toolbox))) return null;
      await this.sync();
      return server ? entries.mintEntry(person, toolbox) : null;
    },
    /** A person who left the household: their entries and cookies end. */
    dropPerson: (person) => entries.dropPerson(person),
    /** Where the page server listens now (`{host, port}`), or null when it is closed. */
    address() { const a = server?.address?.(); return a && typeof a === 'object' ? { host: a.address, port: a.port } : null; },
    /**
     * Open the listener when a toolbox with a page is ON, close it when none is; rows of a toolbox no longer served are
     * dropped. Called at start and after a toolbox is switched on or off.
     */
    sync() {
      syncing = syncing.then(async () => {
        let names = [];
        try { names = (await onToolboxes()) ?? []; } catch { names = []; }
        const served = [];
        for (const n of names) if (await serves(n)) served.push(n);
        try { await entries.keepOnly(served); } catch { /* the rows are checked per request either way */ }
        if (served.length && !server) {
          const s = createServer((req, res) => { handle(req, res).catch(() => { if (!res.headersSent) notFound(req, res); else res.destroy(); }); });
          s.headersTimeout = 10_000; s.requestTimeout = 15_000;
          const up = await new Promise((resolve) => {
            s.once('error', (err) => { log({ what: 'not-listening', reason: err?.code ?? 'error' }); resolve(false); });
            s.listen(port, LOCALHOST, () => resolve(true));
          });
          if (up) { server = s; log({ what: 'listening', port: s.address().port }); }
        } else if (!served.length && server) {
          const s = server; server = null;
          await new Promise((resolve) => { s.close(() => resolve()); s.closeAllConnections?.(); });
          log({ what: 'closed' });
        }
      }).catch(() => {});
      return syncing;
    },
    /** Close the listener (the box stops). */
    async close() { const s = server; server = null; if (s) await new Promise((resolve) => { s.close(() => resolve()); s.closeAllConnections?.(); }); },
  };
}
