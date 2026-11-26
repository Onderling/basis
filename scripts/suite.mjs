#!/usr/bin/env node
/**
 * suite.mjs — run a package's vitest suite and ALWAYS print the failing files with the count.
 *
 *   node scripts/suite.mjs <package dir> [vitest args…]      e.g. node scripts/suite.mjs apps/basis
 *                                                             node scripts/suite.mjs apps/basis test/fitness
 *
 * Why: a red suite read only by its count ("3 failed") gets rerun whole, and the failing files are never read
 * (the retro of 2026-11-25 counted 29 of 134 red suites rerun that way). This prints the dot line while it runs, then
 * a summary: each failing file, its failing tests and the first line of each failure. Exit code = vitest's.
 *
 * With SUITE_LOG=<file> set, one JSON line per run is appended there (when, the package, the counts, the failing
 * files), so a later look at how often which file was red reads a record rather than a memory.
 */
import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { summarize } from './suite-summary.mjs';

const [dirArg, ...rest] = process.argv.slice(2);
if (!dirArg) { console.error('usage: node scripts/suite.mjs <package dir> [vitest args…]'); process.exit(2); }
const dir = path.resolve(dirArg);
if (!existsSync(path.join(dir, 'package.json'))) { console.error(`suite: no package.json in ${dir}`); process.exit(2); }

const tmp = mkdtempSync(path.join(tmpdir(), 'suite-'));
const report = path.join(tmp, 'report.json');
const r = spawnSync('npx', ['vitest', 'run', '--reporter=dot', '--reporter=json', `--outputFile.json=${report}`, ...rest], {
  cwd: dir, stdio: 'inherit',
});

let json = null;
try { json = JSON.parse(readFileSync(report, 'utf8')); } catch { /* vitest died before reporting */ }
rmSync(tmp, { recursive: true, force: true });
if (!json) {
  console.error(`\nsuite: vitest wrote no report (exit ${r.status}); read the output above.`);
  process.exit(r.status || 1);
}

const { text, failedFiles } = summarize(json, dir);
console.log(`\n── suite: ${path.relative(process.cwd(), dir) || '.'} ──\n${text}`);
if (process.env.SUITE_LOG) {
  try {
    appendFileSync(process.env.SUITE_LOG, `${JSON.stringify({
      at: new Date().toISOString(), dir: path.basename(dir), args: rest,
      files: json.numTotalTestSuites, failedFiles, tests: json.numTotalTests, failedTests: json.numFailedTests,
    })}\n`);
  } catch (e) { console.error(`suite: could not append to SUITE_LOG (${e.message})`); }
}
process.exit(r.status ?? 1);
