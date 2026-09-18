#!/usr/bin/env node
/**
 * release-check — may `live` move to the current `development` head?
 *
 * Since 2026-09-18 the browser suite (the TAIL) runs after a merge, not on pull requests: a feature PR
 * merges on the ~8-minute gate, and the tail's verdict lands on the push to `development`. That is what
 * makes this script necessary: it is the one place that asks "did the tail pass on the exact commit we
 * are about to release?" — because nothing else in the path does any more.
 *
 * It reads GitHub through `gh` (the same tool the release PR is made with): the `tests` workflow runs on
 * `development` for the head commit; every job of the newest run must have concluded `success` (or
 * `skipped`, which is how a job absent from a trigger reports). A run still in progress is not green.
 *
 *   npm run release:check              # exit 0: release; exit 1: not yet, and why
 *   npm run release:check -- <sha>     # a specific commit instead of origin/development
 */
import { execFileSync } from 'node:child_process';

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
const say = (m) => console.log(m);

let sha = process.argv[2];
if (!sha) {
  sh('git', ['fetch', '-q', 'origin', 'development']);
  sha = sh('git', ['rev-parse', 'origin/development']);
} else {
  sha = sh('git', ['rev-parse', sha]);   // `gh run list --commit` matches the FULL sha only
}
const short = sha.slice(0, 8);

let runs;
try {
  runs = JSON.parse(sh('gh', ['run', 'list', '--workflow', 'tests', '--branch', 'development', '--commit', sha, '--limit', '5', '--json', 'databaseId,status,conclusion,event,createdAt']));
} catch (e) {
  say(`✖ release-check: could not list runs for ${short} (is gh signed in?): ${e?.message ?? e}`);
  process.exit(2);
}
// The push run is the one that carries the tail; a workflow_dispatch on the same commit counts too.
const candidates = runs.filter((r) => r.event === 'push' || r.event === 'workflow_dispatch').sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
if (candidates.length === 0) {
  say(`✖ release-check: no post-merge run of the tests workflow for development@${short} — the tail never ran on this commit (was it pushed to development?).`);
  process.exit(1);
}
const run = candidates[0];
if (run.status !== 'completed') {
  say(`✖ release-check: the run for development@${short} is ${run.status} (id ${run.databaseId}) — wait for it.`);
  process.exit(1);
}
const jobs = JSON.parse(sh('gh', ['run', 'view', String(run.databaseId), '--json', 'jobs', '--jq', '.jobs']));
const bad = jobs.filter((j) => !['success', 'skipped'].includes(j.conclusion));
const tail = jobs.filter((j) => /^browser \(shard/.test(j.name));
if (tail.length === 0) {
  say(`✖ release-check: the run for development@${short} has no browser shards — the tail did not run on it.`);
  process.exit(1);
}
if (bad.length) {
  say(`✖ release-check: development@${short} is not green — ${bad.map((j) => `${j.name}: ${j.conclusion}`).join(' · ')}`);
  process.exit(1);
}
say(`✔ release-check: development@${short} — ${jobs.length} jobs green, tail included (${tail.length} shards). live may move.`);
