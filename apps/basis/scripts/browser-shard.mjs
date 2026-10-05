#!/usr/bin/env node
/**
 * browser-shard — which spec files one CI shard of the browser suite runs, balanced by MEASURED time.
 *
 * Playwright's own `--shard` splits by test count, and the slow walks clustered: two shards ran 30–37 minutes beside
 * six of 2–16, and the release waited for the slowest. Here each spec file weighs what it took on the tail
 * (`test-browser/shard-durations.json`; a file not measured yet weighs the median), and the files go, heaviest first,
 * to the shard with the least so far. Deterministic: the same files and weights give the same split on every shard.
 *
 *   node scripts/browser-shard.mjs 3/8        # prints shard 3's files, space-separated, for `npx playwright test`
 *
 * A file is the unit (one file belongs to one project, and serial tests inside a file stay together). Refresh the
 * weights from a tail run's logs when the split drifts; a stale weight only unbalances, it never drops a file.
 */
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIR = path.join(HERE, '..', 'test-browser');

/** Every spec file of the browser suite (as Playwright's `testDir` finds them). */
export const specFiles = (dir = DIR) => readdirSync(dir).filter((f) => /\.spec\.(js|mjs|ts)$/.test(f)).sort();

/**
 * @param {string[]} files
 * @param {Record<string, number>} seconds  measured weights
 * @param {number} total  shards
 * @returns {string[][]}  the files of each shard (index 0 = shard 1)
 */
export function planShards(files, seconds, total) {
  const known = files.map((f) => seconds[f]).filter((s) => Number.isFinite(s)).sort((a, b) => a - b);
  const median = known.length ? known[Math.floor(known.length / 2)] : 60;
  const weighed = files.map((f) => ({ f, s: Number.isFinite(seconds[f]) ? seconds[f] : median }))
    .sort((a, b) => b.s - a.s || (a.f < b.f ? -1 : 1));
  const shards = Array.from({ length: total }, () => ({ files: [], s: 0 }));
  for (const w of weighed) {
    const least = shards.reduce((best, sh, i) => (sh.s < shards[best].s ? i : best), 0);
    shards[least].files.push(w.f);
    shards[least].s += w.s;
  }
  return shards.map((sh) => sh.files.sort());
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const m = /^(\d+)\/(\d+)$/.exec(process.argv[2] ?? '');
  if (!m || Number(m[1]) < 1 || Number(m[1]) > Number(m[2])) { console.error('usage: browser-shard.mjs <n>/<total>'); process.exit(2); }
  const { seconds } = JSON.parse(readFileSync(path.join(DIR, 'shard-durations.json'), 'utf8'));
  const mine = planShards(specFiles(), seconds, Number(m[2]))[Number(m[1]) - 1];
  // an empty list would make Playwright run EVERY file: refuse instead
  if (!mine.length) { console.error(`browser-shard: shard ${m[1]}/${m[2]} has no files`); process.exit(3); }
  console.log(mine.map((f) => `test-browser/${f}`).join(' '));
}
