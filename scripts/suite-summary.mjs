/**
 * suite-summary.mjs — turn vitest's JSON report into the lines a person acts on: how many files and tests failed, and
 * for each failing file its failing tests with the first line of each failure. A red run whose failing files nobody
 * read gets rerun whole; this makes the files the first thing printed (scripts/suite.mjs prints it).
 */
import path from 'node:path';

const MAX_TESTS_PER_FILE = 5;
const firstLine = (s) => String(s || '').split('\n').map((l) => l.trim()).find(Boolean) || '';

/** @returns {{ text: string, failedFiles: string[] }} */
export function summarize(json, rootDir) {
  const files = json.numTotalTestSuites ?? (json.testResults || []).length;
  const failed = (json.testResults || []).filter((r) => r.status === 'failed');
  const failedFiles = failed.map((r) => path.relative(rootDir, r.name));
  if (!failed.length && !json.numFailedTests) {
    return { text: `✓ ${files} files, ${json.numTotalTests ?? 0} tests green`, failedFiles };
  }
  const lines = [`✗ ${failed.length} of ${files} files failed (${json.numFailedTests ?? 0} of ${json.numTotalTests ?? 0} tests):`];
  failed.forEach((r, i) => {
    lines.push(`  ${failedFiles[i]}`);
    const bad = (r.assertionResults || []).filter((a) => a.status === 'failed');
    if (!bad.length) { lines.push(`    did not load — ${firstLine(r.message)}`); return; }
    for (const a of bad.slice(0, MAX_TESTS_PER_FILE)) lines.push(`    × ${a.fullName} — ${firstLine((a.failureMessages || [])[0])}`);
    if (bad.length > MAX_TESTS_PER_FILE) lines.push(`    … and ${bad.length - MAX_TESTS_PER_FILE} more`);
  });
  return { text: lines.join('\n'), failedFiles };
}
