#!/usr/bin/env node
/**
 * lint-no-cookies — Basis keeps no state in cookies (Frits 2026-11-26): one declared exception, red on any other.
 *
 * A cookie is state the browser hands back to a server on every request, unasked and outside the app's own storage:
 * it is not in the storage register, it is not sealed, a start-over does not see it, and on a shared origin another
 * page's server receives it. So shipped code neither sets, reads nor sends one. The one exception is the box's
 * toolbox pages (`apps/basis/src/v2/toolboxPages.js`): there a cookie is a server deciding who may load a page's FILES
 * (HttpOnly, Secure, SameSite=Strict, the toolbox's path only); it grants nothing and holds no data.
 *
 * Red on a cookie use in a shipped file outside the exception, with file:line and what to use instead; and red when the
 * exception no longer uses a cookie (a stale exception is a hole left open). Comments are not uses. Tests, specs,
 * probes and dev scripts are not scanned: they are not shipped.
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** The one file that may use a cookie, and why (said in the red message, so a reader sees the rule's edge). */
export const COOKIE_EXCEPTION = Object.freeze({
  'apps/basis/src/v2/toolboxPages.js': "the box's toolbox pages: a server deciding who may load a page's files (HttpOnly, Secure, SameSite=Strict, the toolbox's path only)",
});

/** What counts as a use: each with the advice its red line carries. */
export const COOKIE_USES = Object.freeze([
  { re: /\bdocument\s*\.\s*cookie\b/, what: 'document.cookie', instead: 'a name from the storage register (storageName, sealed where it is content)' },
  { re: /\bcookieStore\b/, what: 'the Cookie Store API', instead: 'a name from the storage register (storageName, sealed where it is content)' },
  { re: /['"`]set-cookie['"`]/i, what: 'a Set-Cookie header', instead: 'a signed token the request carries (as the toolbox entry link does), never a cookie' },
  { re: /\bheaders\s*(?:\.\s*cookie\b|\[\s*['"`]cookie['"`]\s*\]|\.\s*get\s*\(\s*['"`]cookie['"`]\s*\))/i, what: 'reading a request\'s cookies', instead: 'a signed token the request carries, never a cookie' },
  { re: /\b(?:req|request)\s*\.\s*cookies\b|\bres\s*\.\s*(?:cookie|clearCookie)\s*\(/, what: 'a server framework\'s cookie helper', instead: 'a signed token the request carries, never a cookie' },
  { re: /\bcredentials\s*:\s*['"`]include['"`]/, what: "fetch with credentials: 'include' (sends the origin's cookies)", instead: "the default credentials, and the app's own token in the request" },
]);

/** Shipped: the apps and packages, but the end-to-end journey harness (it drives a test pod's own cookie login). */
const SHIPPED = /^(apps|packages)\//;
const HARNESS = /^apps\/e2e-journeys\//;
const NOT_SHIPPED = /(^|\/)(test|tests|test-browser|probes|probes-browser|e2e|__tests__|scripts|node_modules|fixtures)\/|\.(test|spec)\.m?[jt]sx?$/;

/** A line that is only a comment (the repo's comments mention cookies to explain them). */
const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

/** @param {string} file @param {string} text @returns {{file:string,line:number,what:string,instead:string}[]} */
export function cookieUsesIn(file, text) {
  const out = [];
  text.split('\n').forEach((line, i) => {
    if (isComment(line)) return;
    const code = line.replace(/\/\/.*$/, '');
    for (const u of COOKIE_USES) if (u.re.test(code)) out.push({ file, line: i + 1, what: u.what, instead: u.instead });
  });
  return out;
}

/** @param {string} f */
export const isShipped = (f) => SHIPPED.test(f) && !HARNESS.test(f) && !NOT_SHIPPED.test(f) && /\.(m?js|jsx|ts|tsx)$/.test(f);

/** @param {Map<string,string>} files path → text @returns {{red: string[], stale: string[]}} */
export function judge(files) {
  const red = [], stale = [];
  for (const [f, text] of files) {
    if (COOKIE_EXCEPTION[f]) continue;
    for (const h of cookieUsesIn(f, text)) red.push(`${h.file}:${h.line}: ${h.what} → use ${h.instead}`);
  }
  for (const f of Object.keys(COOKIE_EXCEPTION)) {
    const text = files.get(f);
    if (text == null || cookieUsesIn(f, text).length === 0) stale.push(f);
  }
  return { red, stale };
}

const run = () => {
  const list = execSync('git ls-files -- apps packages', { encoding: 'utf8' }).split('\n').filter(isShipped);
  const files = new Map();
  for (const f of list) { try { files.set(f, readFileSync(f, 'utf8')); } catch { /* deleted in the work tree */ } }
  const { red, stale } = judge(files);
  if (red.length || stale.length) {
    if (red.length) {
      console.error(`\n✗ lint-no-cookies — ${red.length} cookie use(s) in shipped code; Basis keeps no state in cookies:\n`);
      for (const r of red) console.error(`  ${r}`);
      console.error(`\nThe one exception: ${Object.entries(COOKIE_EXCEPTION).map(([f, why]) => `${f} (${why})`).join('; ')}.`);
    }
    for (const f of stale) console.error(`\n✗ lint-no-cookies — the exception ${f} uses no cookie any more: remove it from COOKIE_EXCEPTION in scripts/lint-no-cookies.mjs.`);
    process.exit(1);
  }
  console.log(`✓ lint-no-cookies: no cookie in shipped code but the one declared exception (${Object.keys(COOKIE_EXCEPTION).join(', ')}).`);
};
if (import.meta.url === `file://${process.argv[1]}`) run();
