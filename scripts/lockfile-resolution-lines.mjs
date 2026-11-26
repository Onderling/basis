#!/usr/bin/env node
/**
 * What a pnpm lockfile says about RESOLUTION (versions, integrity, specifiers, overrides), without the lines that only
 * repeat what the registry says about a package today. The lockfile-drift job compares a lockfile before and after
 * `pnpm install --lockfile-only` through this, so fresh registry metadata is not reported as drift:
 *
 *   - a `deprecated:` notice or an `engines:` field (one line each);
 *   - a `transitivePeerDependencies:` list. It names the peers of a package's dependencies and holds no version; pnpm
 *     has listed a package's OPTIONAL peers there in one run and not in the next, on the same commit (2026-11-26: ws's
 *     bufferutil and utf-8-validate), which turned the job red with no version moved.
 *
 * Usage: node scripts/lockfile-resolution-lines.mjs < pnpm-lock.yaml
 */
import { fileURLToPath } from 'node:url';

const ONE_LINE = /^\s+(deprecated|engines):/;
const PEER_LIST = /^(\s+)transitivePeerDependencies:\s*$/;

/** The lockfile's text with the registry-metadata lines taken out. Every other line is kept as it is, in order. */
export function resolutionLines(text) {
  const out = [];
  let listIndent = null;                        // inside a transitivePeerDependencies list: the header's indent
  for (const line of String(text).split('\n')) {
    if (listIndent !== null) {
      const item = /^(\s*)- /.exec(line);
      if (item && item[1].length > listIndent) continue;   // an item of the list
      listIndent = null;                                   // anything else ends it, and is judged below
    }
    const head = PEER_LIST.exec(line);
    if (head) { listIndent = head[1].length; continue; }
    if (ONE_LINE.test(line)) continue;
    out.push(line);
  }
  return out.join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let text = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) text += chunk;
  process.stdout.write(resolutionLines(text));
}
