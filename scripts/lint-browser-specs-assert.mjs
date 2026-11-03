#!/usr/bin/env node
/**
 * lint-browser-specs-assert — every spec in apps/basis/test-browser/ asserts something.
 *
 * A walk that only LOGS what it found (PASS / FINDING) passes whatever happens, and the browser tail counted it green:
 * walk-pod passed for months while logging that no circle could be pointed at a pod. A spec that cannot fail is no
 * test; it belongs in apps/basis/probes-browser/ (run by hand, never counted as the suite). Same rule as the function
 * matrix's cells: an `expect`, an `assert`, or a `throw new …Error` — the first thing that can make it fail.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DIR = path.join(ROOT, 'apps/basis/test-browser');

/** Can this spec fail at all? */
export const canFail = (src) => /\bexpect\s*[.(]|\bassert\s*[.(]|\bthrow\s+new\s+\w*Error\b/.test(String(src));

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const specs = readdirSync(DIR).filter((f) => f.endsWith('.spec.js'));
  const bad = specs.filter((f) => !canFail(readFileSync(path.join(DIR, f), 'utf8')));
  if (bad.length) {
    console.log(`✗ lint:browser-specs-assert — ${bad.length} spec(s) in test-browser/ assert nothing (they cannot fail):`);
    for (const f of bad) console.log(`    ${f} — make its FINDINGs expects, or move it to apps/basis/probes-browser/`);
    process.exit(1);
  }
  console.log(`✓ lint:browser-specs-assert — ${specs.length} specs, each can fail`);
}
