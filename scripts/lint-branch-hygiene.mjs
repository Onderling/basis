/**
 * lint-branch-hygiene — the trunk and the release branch move by MERGE, not by commits typed on them.
 *
 * Frits, 2026-09-04: he works mostly through an agent, so the rule needs something that checks it rather
 * than someone remembering it. The pre-commit hook (`.githooks/pre-commit`) catches the mistake as it is
 * made; this catches it afterwards, including when the hook was bypassed or never installed — it fails when
 * a PROTECTED branch carries local commits that are not on its remote, which is exactly what "I committed
 * straight onto the trunk" looks like.
 *
 * Deliberately quiet everywhere else: a feature branch is never checked. ONE skip in CI (2026-11-19, Fable): when the
 * checkout IS the trunk's own push or the merge queue's group commit for it, the commit is by design not on the remote
 * yet (the queue tests it before it lands); the guard read that as typed onto the trunk (run 44578744227). Everywhere
 * else it is as it was.
 */
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const PROTECTED = new Set(['development', 'live', 'master', 'main']);

/**
 * Is this CI's own checkout of `branch` (its push, or the merge queue's group commit for it)?
 * @param {string} branch @param {Record<string, string|undefined>} env
 */
function ciOwnTrunkCheckout(branch, env) {
  if (env.GITHUB_ACTIONS !== 'true') return false;
  const ref = String(env.GITHUB_REF ?? '');
  if (env.GITHUB_EVENT_NAME === 'push') return ref === `refs/heads/${branch}`;
  if (env.GITHUB_EVENT_NAME === 'merge_group') return ref.startsWith(`refs/heads/gh-readonly-queue/${branch}/`);
  return false;
}

/**
 * The guard's verdict, pure.
 * @param {{branch: string, upstream: string, ahead: number, env?: Record<string, string|undefined>}} a
 * @returns {{ok: boolean, skipped?: string, message: string}}
 */
export function hygieneVerdict({ branch, upstream, ahead, env = {} }) {
  if (!branch || !PROTECTED.has(branch)) return { ok: true, message: `✓ branch-hygiene: on '${branch || '(detached)'}' — a feature branch is nobody's business but yours.` };
  if (!upstream) return { ok: true, message: `✓ branch-hygiene: '${branch}' has no upstream to compare against — nothing to check.` };
  if (!ahead) return { ok: true, message: `✓ branch-hygiene: '${branch}' matches ${upstream} — the trunk moves by merge.` };
  if (ciOwnTrunkCheckout(branch, env)) return { ok: true, skipped: 'ci-trunk', message: `✓ branch-hygiene: CI's own checkout of '${branch}' (${env.GITHUB_EVENT_NAME}) — its commit is not on the remote yet by design.` };
  return { ok: false, message: `✖ branch-hygiene: '${branch}' carries ${ahead} local commit(s) not on ${upstream}:` };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const sh = (cmd) => { try { return execSync(cmd, { encoding: 'utf8' }).trim(); } catch { return ''; } };
  const branch = sh('git rev-parse --abbrev-ref HEAD');
  const upstream = PROTECTED.has(branch) ? sh(`git rev-parse --abbrev-ref ${branch}@{upstream}`) : '';
  const ahead = upstream ? Number(sh(`git rev-list --count ${upstream}..${branch}`) || '0') : 0;
  const v = hygieneVerdict({ branch, upstream, ahead, env: process.env });
  if (v.ok) { console.log(v.message); process.exit(0); }
  console.error(v.message);
  for (const s of sh(`git log --oneline ${upstream}..${branch}`).split('\n').filter(Boolean).slice(0, 5)) console.error(`    ${s}`);
  console.error('');
  console.error('  The trunk and the release branch move by MERGE. If these are a feature, move them:');
  console.error(`    git switch -c feat/<name> && git branch -f ${branch} ${upstream}`);
  console.error('  If this IS the merge (a feature landing), push it and this passes.');
  process.exit(1);
}
