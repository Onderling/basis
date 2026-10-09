#!/usr/bin/env node
/**
 * lint-no-relay-literal — the public relay's domain appears nowhere in the tree.
 *
 * There is no default relay. The relay is a setting a person makes (or an invite/enroll offer carries), and a
 * running agent may be GIVEN one as an argument (an env var, a boot flag). A literal in the code is a default by
 * another name, and one in a test or a doc is the next one waiting to be copied into code — so the domain is
 * banned everywhere: code, tests, scripts, docs. Docs write `<relay-domain>`, scripts read an env var, tests use a
 * reserved fixture name (`wss://relay.test`).
 *
 * Scope: every file git knows of or would add (tracked + untracked-not-ignored), so a new file is caught before
 * its first commit. The private plans are gitignored and out of scope by construction.
 *
 * The domain is assembled from parts below so this guard does not trip on itself.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const PARTS = ['relay', 'onderling', 'org'];
export const RELAY_DOMAIN = PARTS.join('.');
// the domain as written, or regex-escaped (`relay\.…` in a test's pattern) — a dot with an optional backslash before it
const DOMAIN_RE = PARTS.join('\\\\?\\.');

/**
 * The lines of a text that name the relay domain (case-insensitive), 1-based.
 * @param {string} text
 * @returns {Array<{ line: number, text: string }>}
 */
export function relayLiteralHits(text) {
  const re = new RegExp(DOMAIN_RE, 'i');
  const out = [];
  String(text ?? '').split('\n').forEach((l, i) => { if (re.test(l)) out.push({ line: i + 1, text: l.trim() }); });
  return out;
}

/** `file:line: text` for every hit in the tree (tracked + untracked-not-ignored). */
export function treeHits(cwd = ROOT) {
  try {
    const out = execFileSync('git', ['grep', '-n', '-i', '-I', '--untracked', '-E', DOMAIN_RE], { cwd, encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch (err) {
    if (err.status === 1) return [];      // git grep: no match
    throw err;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const hits = treeHits();
  if (hits.length) {
    console.error(`lint-no-relay-literal: the relay domain is named ${hits.length}× — there is no default relay; use an argument (env), \`<relay-domain>\` in docs, or wss://relay.test in tests:`);
    for (const h of hits) console.error(`  ${h.slice(0, 200)}`);
    process.exit(1);
  }
  console.log('lint-no-relay-literal: the relay domain is named nowhere in the tree');
}
