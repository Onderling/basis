#!/usr/bin/env node
/**
 * release-check — may `live` move to the current `development` head?
 *
 * Since 2026-09-18 the browser suite (the TAIL) runs after a merge, not on pull requests: a feature PR
 * merges on the ~8-minute gate, and the tail's verdict lands on the push to `development`. That is what
 * makes this script necessary: it is the one place that asks "did the tail pass on the bytes we are
 * about to release?" — because nothing else in the path does any more.
 *
 * The proof belongs to the BYTES, not to the commit id (2026-10-05): a commit passes when a commit with
 * the same tree has a green run with the browser shards (`release-verdict.mjs`), and it says which run it
 * leaned on. A same-tree run that is red or still running refuses — rerun it.
 *
 * It reads GitHub through `gh` (the same tool the release PR is made with). Three ways in:
 *
 *   npm run release:check                    # origin/development's head — exit 0: release; exit 1: not yet, and why
 *   npm run release:check -- <sha>           # a specific commit (the release PR's `release-check` job passes its head)
 *   node scripts/release-check.mjs --same-bytes <sha>
 *       the tests workflow's first job: do this commit's bytes already have a green tail (its own run left out)?
 *       Prints the answer and writes `same=true|false` and `leaned=<sha>` to $GITHUB_OUTPUT. Never fails the job.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { verdictFor } from './release-verdict.mjs';

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();
const say = (m) => console.log(m);

const args = process.argv.slice(2);
const sameBytes = args[0] === '--same-bytes';
let sha = sameBytes ? args[1] : args[0];
if (!sha) {
  sh('git', ['fetch', '-q', 'origin', 'development']);
  sha = sh('git', ['rev-parse', 'origin/development']);
} else {
  sha = sh('git', ['rev-parse', sha]);   // `gh run list --commit` matches the FULL sha only
}
const short = (s) => String(s).slice(0, 8);

const io = {
  treeOf: (c) => sh('git', ['rev-parse', `${c}^{tree}`]),
  parentsOf: (c) => { try { return sh('git', ['rev-list', '--parents', '-n', '1', c]).split(/\s+/).slice(1); } catch { return []; } },
  // The push run is the one that carries the tail; a workflow_dispatch on the same commit counts too.
  runsFor: (c) => JSON.parse(sh('gh', ['run', 'list', '--workflow', 'tests', '--commit', c, '--limit', '5', '--json', 'databaseId,status,conclusion,event,createdAt'])),
  jobsOf: (id) => JSON.parse(sh('gh', ['run', 'view', String(id), '--json', 'jobs', '--jq', '.jobs'])),
};

let v;
try {
  v = verdictFor(sha, { ...io, excludeRunId: sameBytes && process.env.GITHUB_RUN_ID ? Number(process.env.GITHUB_RUN_ID) : null });
} catch (e) {
  say(`✖ release-check: could not read the runs for ${short(sha)} (is gh signed in? are the parents fetched?): ${e?.message ?? e}`);
  if (sameBytes) { writeOutput({ same: 'false' }); process.exit(0); }
  process.exit(2);
}

function writeOutput(o) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(o).map(([k, val]) => `${k}=${val}\n`).join(''));
}

if (sameBytes) {
  if (v.ok) {
    say(`= same bytes as ${short(v.leanedOn)}: its run ${v.runId} passed with the tail (${v.shards} shards) — every other job is skipped.`);
    writeOutput({ same: 'true', leaned: v.leanedOn });
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Same bytes as ${short(v.leanedOn)}\nIts run [${v.runId}](${process.env.GITHUB_SERVER_URL ?? 'https://github.com'}/${process.env.GITHUB_REPOSITORY ?? ''}/actions/runs/${v.runId}) passed with the tail; this run skips the rest.\n`);
  } else {
    say(`≠ new bytes (${v.reason}${v.at ? ` at ${short(v.at)}` : ''}) — the full run.`);
    writeOutput({ same: 'false' });
  }
  process.exit(0);
}

if (v.ok) {
  const leaned = v.leanedOn === sha ? '' : ` — same bytes as ${short(v.leanedOn)}, whose run it leans on`;
  say(`✔ release-check: ${short(sha)}: run ${v.runId} green, tail included (${v.shards} shards)${leaned}. live may move.`);
  process.exit(0);
}
const why = {
  running: `the run for ${short(v.at)} (same bytes) is still going (id ${v.runId}) — wait for it.`,
  red: `the run for ${short(v.at)} (same bytes) is not green — ${v.detail}. Rerun it.`,
  'no-tail': 'no green run with the tail on these bytes — the tail never ran on them (was it pushed to development?).',
}[v.reason] ?? v.reason;
say(`✖ release-check: ${short(sha)}: ${why}`);
process.exit(1);
