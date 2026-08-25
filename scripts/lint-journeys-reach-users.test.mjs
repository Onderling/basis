/**
 * Self-test for the journeys-reach-users guard (a guard whose test is red is not a guard —
 * guards.mjs runs `vitest run scripts/`).
 *
 * The three conditions are driven against the PURE comparison with made-up inputs, not against the
 * tree. The first version of this file spawned the guard and asserted it failed — which only worked
 * while the tree still contained an unreached op, so the moment the last one was closed the test
 * proving "unreached ops fail" could no longer fail, and went red. A rule you can only test while it
 * is being broken is not much of a rule.
 */
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findUnreached, opsIn, reachedIn } from './journeys-reach-users.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GUARD = path.join(HERE, 'lint-journeys-reach-users.mjs');
const BASELINE = path.join(HERE, 'journeys-reach-users-baseline.json');
const run = () => spawnSync(process.execPath, [GUARD], { encoding: 'utf8' });

const verbs = { setMemberRole: 'update', listRequests: 'list', addItem: 'add', enrollDevice: 'update' };

describe('the comparison — the three conditions, each on its own', () => {
  it('reports a WRITE op a journey drives and nothing reaches — the thing it exists for', () => {
    expect(findUnreached({ journeyOps: ['stoop:setMemberRole'], reached: [], verbs }))
      .toEqual(['stoop:setMemberRole']);
  });

  it('says nothing about a READ op — a journey listing things is its eyes, not a feature claim', () => {
    expect(findUnreached({ journeyOps: ['stoop:listRequests'], reached: [], verbs })).toEqual([]);
  });

  it('says nothing when the op is reached under a DIFFERENT origin', () => {
    // basis re-exposes other apps' ops as its own, so matching the origin too would invent gaps.
    expect(findUnreached({ journeyOps: ['household:addItem'], reached: ['addItem'], verbs })).toEqual([]);
  });

  it('says nothing when production only REGISTERS a handler for it', () => {
    // The receiving half of a two-device handshake is reached by the person on the other device.
    const reached = reachedIn("hostAgent.register('enrollDevice', async () => {});");
    expect([...reached]).toContain('enrollDevice');
    expect(findUnreached({ journeyOps: ['household:enrollDevice'], reached, verbs })).toEqual([]);
  });

  it('says nothing about an op no manifest declares — it cannot judge what it cannot read', () => {
    expect(findUnreached({ journeyOps: ['stoop:whoKnows'], reached: [], verbs })).toEqual([]);
  });
});

describe('what counts as driving and reaching', () => {
  it('reads the waist through any alias, and the journeys own call() helper', () => {
    const ops = opsIn(
      "await rawCallSkill('stoop','acknowledgeCaretaker',{});\nawait call(bram,'setMemberRole',{});",
      'stoop',
    );
    expect([...ops].sort()).toEqual(['stoop:acknowledgeCaretaker', 'stoop:setMemberRole']);
  });

  it('ignores comments — prose about a retired op is not a call site', () => {
    expect([...opsIn("// callSkill('stoop','ghostOp')\n/* skill('stoop','other') */")]).toEqual([]);
  });
});

describe('the guard on the current tree', () => {
  it('is green, and every carried gap has a real reason', () => {
    const r = run();
    expect(r.stdout + r.stderr).toMatch(/op\(s\) walked by journeys/);
    expect(r.status).toBe(0);

    for (const [op, reason] of Object.entries(JSON.parse(readFileSync(BASELINE, 'utf8')))) {
      // A placeholder is how a baseline turns from a record into a shrug.
      expect(reason, `${op} carries a placeholder reason`).not.toMatch(/REASON NEEDED/);
      expect(reason.length, `${op}'s reason says too little`).toBeGreaterThan(60);
    }
  });

  it('FAILS on a baselined gap that has since been closed — debt must not outlive itself', () => {
    const original = readFileSync(BASELINE, 'utf8');
    try {
      const current = JSON.parse(original);
      writeFileSync(BASELINE, JSON.stringify({ ...current, 'stoop:leaveGroup': 'reached long ago' }));
      const r = run();
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/now REACHED/);
      expect(r.stderr).toMatch(/stoop:leaveGroup/);
    } finally { writeFileSync(BASELINE, original); }
  });
});
