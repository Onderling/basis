/**
 * carrying — the carrying index (`docs/conventions/carrying-index.md`) held to the code; `lint-carrying.mjs` runs it.
 *
 * Two mechanisms were built beside ones that existed in one week (a file store for the agenda link beside the
 * companion's blob bucket; a pub/sub question beside `protocol/pubSub.js`). The index lists every way bytes move or
 * wait, by verb. This guard keeps it true in two directions:
 *   1. BUILT BESIDE THE TABLE — the servers' HTTP routes and persisted stores are found in their source and each must be
 *      declared below, naming its row in the table (or why it carries nothing). The guard cannot know a new route is a
 *      duplicate; it makes the builder open the table, where the neighbour is.
 *   2. A ROW NOBODY REACHES — every "used today by" file must exist and reference the row's mechanism (a name from its
 *      "lives in" cell). A row in the inert table is allowed and counted.
 */

/** Where servers keep routes and stores, and how a route or a store is recognised in that file's text. */
export const SERVER_FILES = Object.freeze([
  { file: 'apps/companion-node/src/manageServer.js', kind: 'route', find: /['`](\/[a-z][a-z0-9_.-]*)/g },
  { file: 'packages/relay/src/blobGateMount.js', kind: 'route', find: /['`](\/[a-z][a-z0-9_.-]*)/g },
  { file: 'packages/relay/src/server.js', kind: 'route', find: /['`](\/[a-z][a-z0-9_.-]*)/g },
  { file: 'apps/companion-node/src/index.js', kind: 'store', find: /join\(resolveConfigDir\(configDir\), '([^']+)'\)|_FILE = '([^']+)'/g },
  { file: 'packages/relay/bin/relay.js', kind: 'store', find: /process\.env\.([A-Z_]+_DB)\b/g },
]);

/**
 * Every route (by its first path segment) and every persisted store a server keeps: the row of the table it belongs to
 * (the row's first cell, word for word), or `notCarrying` with the reason it moves nobody's data.
 */
export const CARRIERS = Object.freeze([
  { id: '/feed', row: 'serve something at a link to a program that holds no key (a calendar app)' },
  { id: '/manage', notCarrying: "the owner's management page for their own node: its status and its grants, nobody's data" },
  { id: '/grant', notCarrying: 'a sub-path of the blob gate (/blob-gate/grant), declared with it' },
  { id: '/upload-url', notCarrying: 'a sub-path of the blob gate (/blob-gate/upload-url), declared with it' },
  { id: '/blob-gate', row: 'serve the photo edge over HTTP' },
  { id: 'feeds', row: 'serve something at a link to a program that holds no key (a calendar app)' },
  { id: 'sealed-inbox.json', row: 'drop sealed mail for an away owner at a companion' },
  { id: 'host-identity.json', notCarrying: "the node's own key pair" },
  { id: 'QUEUE_DB', row: 'keep a message for an address that is offline, at the relay' },
  { id: 'PUSH_TOKENS_DB', row: 'wake a sleeping phone' },
]);

/** The routes and stores a server file holds, from its text. */
export function findCarriers(text, find) {
  const out = new Set();
  for (const m of String(text).matchAll(find)) {
    const v = m.slice(1).find(Boolean);
    if (!v) continue;
    out.add(v.startsWith('/') ? `/${v.split('/')[1]}` : v);
  }
  return [...out];
}

/** The index's rows: `{first, livesIn, usedBy, inert}` per table row, from the markdown. */
export function parseIndex(md) {
  const rows = [];
  let inert = false;
  for (const line of String(md).split('\n')) {
    if (/^## /.test(line)) inert = /^## Inert/.test(line);
    if (!/^\|/.test(line) || /^\|\s*-/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (/^(I want to…|What it would do)$/.test(cells[0])) continue;
    if (inert) rows.push({ first: cells[0], livesIn: cells[2] ?? '', usedBy: cells[3] ?? '', inert: true });
    else rows.push({ first: cells[0], livesIn: cells[2] ?? '', usedBy: cells[4] ?? '', inert: false });
  }
  return rows;
}

const ticks = (cell) => [...String(cell).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
/** The names a consumer must mention to reach a row's mechanism: file names without extension, identifiers, packages. */
export function keysOf(livesIn) {
  return ticks(livesIn).flatMap((t) => t.split(/[\s,]+/)).map((t) => t.replace(/^@onderling\//, '').replace(/^.*\//, '').replace(/\.(m?js)$/, '').replace(/[()]/g, ''))
    .filter((k) => k.length >= 4);
}
/** The files a row says use it today (backticked `.js`/`.mjs` paths or names). */
export const consumersOf = (usedBy) => ticks(usedBy).filter((t) => /\.m?js$/.test(t));

/**
 * The guard. `read(rel)` reads a repo file; `files` is the repo's tracked production files.
 * @returns {{unlisted: object[], unknownRow: object[], unreached: object[], inert: number, rows: number}}
 */
export function checkCarrying({ read, files, carriers = CARRIERS, serverFiles = SERVER_FILES, indexPath = 'docs/conventions/carrying-index.md' }) {
  const rows = parseIndex(read(indexPath));
  const firsts = new Set(rows.map((r) => r.first));
  const declared = new Map(carriers.map((c) => [c.id, c]));
  const unlisted = [];
  for (const s of serverFiles) {
    for (const id of findCarriers(read(s.file), s.find)) if (!declared.has(id)) unlisted.push({ id, kind: s.kind, file: s.file });
  }
  const unknownRow = carriers.filter((c) => c.row && !firsts.has(c.row)).map((c) => ({ id: c.id, row: c.row }));
  const unreached = [];
  for (const r of rows.filter((x) => !x.inert)) {
    const keys = keysOf(r.livesIn);
    const consumers = consumersOf(r.usedBy);
    if (!consumers.length) { unreached.push({ row: r.first, why: 'no production file named in "used today by"' }); continue; }
    for (const c of consumers) {
      const matches = files.filter((f) => f === c || f.endsWith(`/${c}`));
      if (!matches.length) { unreached.push({ row: r.first, consumer: c, why: 'no such file' }); continue; }
      if (!matches.some((f) => keys.some((k) => read(f).includes(k)))) unreached.push({ row: r.first, consumer: c, why: `mentions none of ${keys.join(', ')}` });
    }
  }
  return { unlisted, unknownRow, unreached, inert: rows.filter((r) => r.inert).length, rows: rows.length };
}
