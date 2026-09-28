#!/usr/bin/env node
/**
 * lint-hosts-literals — every host an app's code names in a URL literal is in that app's manifest `hosts`.
 *
 * `hosts` (the manifest's top-level list of the network hosts an app's code reaches) has two consumers:
 * `--allow-net`, which will enforce it when an extension runs in a realm, and certification and the consent
 * card, which read the declaration itself. So the list must be TRUE, and `lint-manifest-scopes` only checks
 * that it is there. This guard checks the part that can be checked cheaply: a hostname written into the
 * source as a URL literal — `'https://api.example.org/v1'`, `` `wss://relay.example.net` `` — must be
 * declared in the `hosts` of the app whose source it is in.
 *
 * WHAT IT MISSES, said plainly: a URL whose host is COMPUTED (`https://${host}/…`, `new URL(path, base)`)
 * and a host READ FROM CONFIG (an env var, a setting, a relay or pod the person chose, a push endpoint that
 * comes in a subscription) pass this guard, because there is no literal to read. It catches the hard-coded
 * API URL — which is the whole population of fixed hosts today — and nothing else. It is a convention
 * checker, not a sandbox: the realm is what makes `hosts` bind.
 *
 * Scope:
 *   • which app: each `apps/<dir>/manifest.js`, scanned over `<dir>/{src,web,bin}`. `apps/basis-mobile` is a
 *     shell of basis (it composes basis's manifest), so its `src` counts against basis's `hosts`.
 *   • which text: string literals only — the scanner drops comments first, so a URL in prose, a JSDoc
 *     example or a licence header is not a network call.
 *   • skipped as not code that runs: tests (`test/`, `tests/`, `__tests__/`, `test-browser/`, `e2e/`,
 *     `*.test.*`, `*.spec.*`), fixtures, docs, `node_modules`, and build output.
 *   • skipped as not an internet host: a name with no dot (`localhost`, a placeholder like `https://relay`),
 *     an IP literal, and the reserved example names (`example.com/.org/.net`, `*.example`, `*.invalid`,
 *     `*.test`, `*.localhost` — RFC 2606 / 6761).
 *   • skipped as an identifier, not a call — `NOT_A_NETWORK_CALL` below, by URL prefix, each with its reason.
 */
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);

/**
 * URL literals that name something the code never contacts, by URL PREFIX (not by host, so a real call to the
 * same host still has to be declared): a namespace IRI names a vocabulary, a DTD identifier names a document
 * type, and a project link written for a person to read is not fetched by the code. A new entry needs its
 * reason — "we call it but did not want to declare it" is not one — and an entry nothing matches any more is
 * red, so the list cannot quietly outlive its reasons.
 */
export const NOT_A_NETWORK_CALL = Object.freeze({
  'http://www.w3.org/': 'RDF / Solid vocabulary IRIs — namespace prefixes, never fetched',
  'https://onderling.org/ns#': "Onderling's own vocabulary namespace in the pod's Turtle — an identifier",
  'http://www.apple.com/DTDs/': "the property-list DOCTYPE in folio's launchd unit — a document-type identifier",
  'https://github.com/Onderling': "a project link for people: the geocoder's User-Agent contact and a systemd unit's Documentation= line",
  'https://t.me/': "a Telegram invite link the bot hands its admin to pass on (opens the bot, sends the code) — shown, never fetched",
});

const SOURCE_DIRS = ['src', 'web', 'bin'];
const SKIP_DIRS = new Set(['node_modules', 'test', 'tests', '__tests__', 'test-browser', 'e2e', 'fixtures', '__fixtures__', 'docs', 'dist', 'build', 'coverage', 'tmp', '.expo']);
const SOURCE_FILE = /\.(m?js|cjs|jsx|ts|tsx)$/;
const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;
const URL_HOST = /\b(?:https?|wss?):\/\/([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*)[^\s'"`<>]*/g;

/**
 * The string literals of a JS/TS source, with comments dropped. A small scanner, not a parser: it tracks
 * line comments, block comments and the three quote kinds (template literals included, `${…}` parts kept
 * as text — a host interpolated there is computed, and the host regex will not match `${`). Regex
 * literals are not recognised; a URL inside one is escaped (`\/\/`) and does not match either.
 * @param {string} src
 * @returns {string[]}
 */
export function stringLiterals(src) {
  const out = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') { while (i < n && src[i] !== '\n') i += 1; continue; }
    if (c === '/' && next === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? n : end + 2; continue; }
    if (c === '\'' || c === '"' || c === '`') {
      let j = i + 1;
      let buf = '';
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') { buf += src[j] + (src[j + 1] ?? ''); j += 2; continue; }
        if (c !== '`' && src[j] === '\n') break;   // an unterminated quote: stop at the line
        buf += src[j]; j += 1;
      }
      out.push(buf);
      i = j + 1;
      continue;
    }
    i += 1;
  }
  return out;
}

/** Is this a name the internet would resolve (not a placeholder, an IP, or a reserved example name)? */
export function isInternetHost(host) {
  const h = host.toLowerCase();
  if (!h.includes('.')) return false;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return false;
  if (/^(example\.(com|org|net)|.*\.example\.(com|org|net))$/.test(h)) return false;
  if (/\.(example|invalid|test|localhost)$/.test(h)) return false;
  return true;
}

/**
 * The hosts named in URL literals of one source text that are neither declared nor allowed.
 * @param {string} src
 * @param {string[]} declared  the manifest's `hosts`
 * @param {Set<string>} [used]  collects the `NOT_A_NETWORK_CALL` prefixes that matched (for the stale check)
 * @returns {string[]}
 */
export function undeclaredHosts(src, declared, used = new Set()) {
  const ok = new Set((declared ?? []).map((h) => h.toLowerCase()));
  const found = new Set();
  for (const lit of stringLiterals(src)) {
    for (const m of lit.matchAll(URL_HOST)) {
      const host = m[1].toLowerCase();
      if (!isInternetHost(host) || ok.has(host)) continue;
      const allowed = Object.keys(NOT_A_NETWORK_CALL).find((prefix) => m[0].startsWith(prefix));
      if (allowed) { used.add(allowed); continue; }
      found.add(host);
    }
  }
  return [...found].sort();
}

function* sourceFiles(dir) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* sourceFiles(p);
    else if (SOURCE_FILE.test(name) && !TEST_FILE.test(name)) yield p;
  }
}

/** The shells that compose ANOTHER app's manifest: their source counts against that app's `hosts`. */
export const SHELL_OF = Object.freeze({ 'basis-mobile': 'basis' });

/** Every app with a manifest: `{ dir, app, hosts, roots }` — `roots` are the directories its source lives in. */
export async function appsWithManifests(root = ROOT) {
  const apps = [];
  for (const dir of readdirSync(path.join(root, 'apps')).sort()) {
    const file = path.join(root, 'apps', dir, 'manifest.js');
    if (!existsSync(file)) continue;
    const manifest = (await import(pathToFileURL(file).href)).default;
    const roots = SOURCE_DIRS.map((d) => path.join(root, 'apps', dir, d));
    for (const [shell, of] of Object.entries(SHELL_OF)) {
      if (of === dir) roots.push(...SOURCE_DIRS.map((d) => path.join(root, 'apps', shell, d)));
    }
    apps.push({ dir, app: manifest.app, hosts: manifest.hosts ?? [], roots });
  }
  return apps;
}

async function main() {
  const misses = [];
  const used = new Set();
  const apps = await appsWithManifests();
  for (const { dir, hosts, roots } of apps) {
    for (const r of roots) {
      for (const f of sourceFiles(r)) {
        for (const host of undeclaredHosts(readFileSync(f, 'utf8'), hosts, used)) {
          misses.push(`  apps/${dir}: ${host} — ${path.relative(ROOT, f)}`);
        }
      }
    }
  }
  for (const prefix of Object.keys(NOT_A_NETWORK_CALL)) {
    if (!used.has(prefix)) misses.push(`  NOT_A_NETWORK_CALL '${prefix}' matches nothing any more — remove it`);
  }
  if (misses.length) {
    console.error(misses.join('\n'));
    console.error(`lint-hosts-literals: ${misses.length} problem(s) — a URL literal names a host its app's manifest does not declare in \`hosts\`, or an allow-list entry is stale`);
    process.exit(1);
  }
  console.log(`lint-hosts-literals: ${apps.length} apps — every hostname in a URL literal is declared in that app's \`hosts\``);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
