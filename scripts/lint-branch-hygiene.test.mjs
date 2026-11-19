import { describe, it, expect } from 'vitest';
import { hygieneVerdict } from './lint-branch-hygiene.mjs';

const ahead = { branch: 'development', upstream: 'origin/development', ahead: 1 };

describe('lint-branch-hygiene', () => {
  it('a protected branch with local commits fails on a person\'s machine', () => {
    expect(hygieneVerdict({ ...ahead, env: {} }).ok).toBe(false);
  });
  it('a feature branch, no upstream, or nothing ahead: passes', () => {
    expect(hygieneVerdict({ branch: 'feat/x', upstream: 'origin/feat/x', ahead: 3, env: {} }).ok).toBe(true);
    expect(hygieneVerdict({ branch: 'development', upstream: '', ahead: 2, env: {} }).ok).toBe(true);
    expect(hygieneVerdict({ ...ahead, ahead: 0, env: {} }).ok).toBe(true);
  });
  it('CI\'s OWN checkout of the trunk (its push, or the merge queue\'s group commit) is skipped: by design not on the remote yet', () => {
    expect(hygieneVerdict({ ...ahead, env: { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'merge_group', GITHUB_REF: 'refs/heads/gh-readonly-queue/development/pr-1426-abc' } })).toMatchObject({ ok: true, skipped: 'ci-trunk' });
    expect(hygieneVerdict({ ...ahead, env: { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/development' } })).toMatchObject({ ok: true, skipped: 'ci-trunk' });
  });
  it('everywhere else it stays as it was: CI on a pull request, or a push of ANOTHER branch, still fails', () => {
    expect(hygieneVerdict({ ...ahead, env: { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'pull_request', GITHUB_REF: 'refs/pull/9/merge' } }).ok).toBe(false);
    expect(hygieneVerdict({ ...ahead, env: { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/feat/x' } }).ok).toBe(false);
    expect(hygieneVerdict({ ...ahead, env: { GITHUB_ACTIONS: 'true', GITHUB_EVENT_NAME: 'merge_group', GITHUB_REF: 'refs/heads/gh-readonly-queue/live/pr-1' } }).ok).toBe(false);
    expect(hygieneVerdict({ ...ahead, env: { GITHUB_EVENT_NAME: 'merge_group', GITHUB_REF: 'refs/heads/gh-readonly-queue/development/pr-1' } }).ok, 'not inside Actions: no skip').toBe(false);
  });
});
