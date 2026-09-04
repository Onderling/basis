/**
 * lint-branch-hygiene — the trunk and the release branch move by MERGE, not by commits typed on them.
 *
 * Frits, 2026-09-04: he works mostly through an agent, so the rule needs something that checks it rather
 * than someone remembering it. The pre-commit hook (`.githooks/pre-commit`) catches the mistake as it is
 * made; this catches it afterwards, including when the hook was bypassed or never installed — it fails when
 * a PROTECTED branch carries local commits that are not on its remote, which is exactly what "I committed
 * straight onto the trunk" looks like.
 *
 * Deliberately quiet everywhere else: a feature branch is never checked, and in CI the branch is checked out
 * at the remote's head, so there are no local-only commits and this passes.
 */
import { execSync } from 'node:child_process';

const PROTECTED = new Set(['development', 'live', 'master', 'main']);
const sh = (cmd) => { try { return execSync(cmd, { encoding: 'utf8' }).trim(); } catch { return ''; } };

const branch = sh('git rev-parse --abbrev-ref HEAD');
if (!branch || !PROTECTED.has(branch)) {
  console.log(`✓ branch-hygiene: on '${branch || '(detached)'}' — a feature branch is nobody's business but yours.`);
  process.exit(0);
}

const upstream = sh(`git rev-parse --abbrev-ref ${branch}@{upstream}`);
if (!upstream) {
  console.log(`✓ branch-hygiene: '${branch}' has no upstream to compare against — nothing to check.`);
  process.exit(0);
}

const ahead = sh(`git rev-list --count ${upstream}..${branch}`);
const n = Number(ahead || '0');
if (n === 0) {
  console.log(`✓ branch-hygiene: '${branch}' matches ${upstream} — the trunk moves by merge.`);
  process.exit(0);
}

const subjects = sh(`git log --oneline ${upstream}..${branch}`).split('\n').filter(Boolean).slice(0, 5);
console.error(`✖ branch-hygiene: '${branch}' carries ${n} local commit(s) not on ${upstream}:`);
for (const s of subjects) console.error(`    ${s}`);
console.error('');
console.error('  The trunk and the release branch move by MERGE. If these are a feature, move them:');
console.error(`    git switch -c feat/<name> && git branch -f ${branch} ${upstream}`);
console.error('  If this IS the merge (a feature landing), push it and this passes.');
process.exit(1);
