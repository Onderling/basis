/**
 * bot-side propose / accept / decline / proposals / force-complete.
 */

import { describe, it, expect, beforeEach } from 'vitest';

import { dispatch } from '../src/bot/dispatch.js';
import { buildBundle } from '../src/storage/buildBundle.js';
import { createCircleAgent } from '../src/Circle.js';

const ANNE  = 'https://id.example/anne';
const FRITS = 'https://id.example/frits';
const KID   = 'https://id.example/kid';

const CIRCLE = {
  circleId:  'oss-tools',
  name:    'OSS Tools NL',
  kind:    'project',
  members: [
    { webid: ANNE,  displayName: 'Anne',  role: 'admin' },
    { webid: FRITS, displayName: 'the author', role: 'coordinator' },
    { webid: KID,   displayName: 'Kid',   role: 'member' },
  ],
};

function call(circle, name, data, from) {
  return circle.agent.skills.get(name).handler({
    parts: [{ type: 'DataPart', data: data ?? {} }],
    from,
    agent: circle.agent,
    envelope: null,
  });
}

async function setup() {
  const bundle = buildBundle();
  const circle = await createCircleAgent({
    circleConfig:           CIRCLE,
    localStoreBundle:     bundle,
    wireOnboardingSkills: false,
  });
  return { bundle, circle };
}

describe('V2.7 — dispatch parses propose / accept / decline / proposals / force-complete', () => {
  it('"propose <pid> <text>"', () => {
    const a = dispatch('propose 01abcdef add gate hinge');
    expect(a.skillId).toBe('bot.propose');
    expect(a.args.parentTaskId).toBe('01abcdef');
    expect(a.args.text).toBe('add gate hinge');
  });
  it('"propose" alone replies with usage hint', () => {
    expect(dispatch('propose').kind).toBe('reply');
  });
  it('"accept-proposal <id>"', () => {
    expect(dispatch('accept-proposal 01ABCDEF')).toEqual({
      kind: 'skill', skillId: 'bot.acceptProposal', args: { proposalId: '01abcdef' },
    });
  });
  it('"decline-proposal <id> reason: …"', () => {
    const a = dispatch('decline-proposal 01ABCDEF reason: not now');
    expect(a.skillId).toBe('bot.declineProposal');
    expect(a.args.proposalId).toBe('01abcdef');
    expect(a.args.note).toBe('not now');
  });
  it('"proposals"', () => {
    expect(dispatch('proposals')).toEqual({
      kind: 'skill', skillId: 'bot.listProposals', args: {},
    });
  });
  it('"force-complete <id> reason: …"', () => {
    const a = dispatch('force-complete 01ABCDEF reason: project cancelled');
    expect(a.skillId).toBe('bot.forceComplete');
    expect(a.args.id).toBe('01abcdef');
    expect(a.args.reason).toBe('project cancelled');
  });
  it('"force-complete" without a reason → reply', () => {
    const a = dispatch('force-complete 01ABCDEF anything');
    expect(a.kind).toBe('reply');
    expect(a.text).toMatch(/reason/i);
  });
});

describe('V2.7 — bot.* propose flow end-to-end', () => {
  let circle;
  beforeEach(async () => { ({ circle } = await setup()); });

  it('full propose → accept flow renders and commits', async () => {
    const p = await call(circle, 'addTask', { text: 'Paint fence', approval: 'creator' }, ANNE);
    await call(circle, 'claimTask',  { id: p.task.id }, KID);
    await call(circle, 'submitTask', { id: p.task.id }, KID);

    // Coordinator proposes via bot.
    const propose = circle.agent.skills.get('bot.propose');
    const r1 = await propose.handler({
      parts: [{ type: 'DataPart', data: { parentTaskId: p.task.id, text: 'add gate hinge' } }],
      from: FRITS, agent: circle.agent, envelope: null,
    });
    expect(r1.text).toMatch(/Proposed sub-task to kid/i);

    // Assignee lists their proposals via bot.
    const list = circle.agent.skills.get('bot.listProposals');
    const r2 = await list.handler({ parts: [], from: KID, agent: circle.agent, envelope: null });
    expect(r2.text).toMatch(/waiting/);
    expect(r2.text).toMatch(/add gate hinge/);

    // Pull the proposalId from the rendered text — short-id only;
    // resolve to the full id via getById prefix walk.
    const open = await circle.itemStore.listOpen({ type: 'inbox-item' });
    const proposal = open[0];

    // Assignee approves via bot.
    const accept = circle.agent.skills.get('bot.acceptProposal');
    const r3 = await accept.handler({
      parts: [{ type: 'DataPart', data: { proposalId: proposal.id } }],
      from: KID, agent: circle.agent, envelope: null,
    });
    expect(r3.text).toMatch(/spawned/);
    expect(r3.text).toMatch(/rolled back/);

    // Parent should be back to claimed (not submitted).
    const parent = await circle.itemStore.getById(p.task.id);
    expect(parent.assignee).toBe(KID);
    const reject = (parent.reviewLog ?? []).find((e) => e.decision === 'reject');
    expect(reject?.note).toMatch(/auto-rollback/);
  });

  it('decline flow keeps the submission valid', async () => {
    const p = await call(circle, 'addTask', { text: 'Paint', approval: 'creator' }, ANNE);
    await call(circle, 'claimTask',  { id: p.task.id }, KID);
    await call(circle, 'submitTask', { id: p.task.id }, KID);
    await call(circle, 'proposeSubtask',
      { parentTaskId: p.task.id, text: 'extra' }, ANNE);
    const open = await circle.itemStore.listOpen({ type: 'inbox-item' });
    const proposal = open[0];

    const decline = circle.agent.skills.get('bot.declineProposal');
    const r = await decline.handler({
      parts: [{ type: 'DataPart', data: { proposalId: proposal.id, note: 'not now' } }],
      from: KID, agent: circle.agent, envelope: null,
    });
    expect(r.text).toMatch(/Declined/);
    expect(r.text).toMatch(/stays valid/);

    // Parent should still be approvable by Anne.
    const ap = await call(circle, 'approveTask', { id: p.task.id }, ANNE);
    expect(ap.task?.completedAt).toBeGreaterThan(0);
  });

  it('bot.forceComplete admin-only; mandatory reason; bypasses gate', async () => {
    const p = await call(circle, 'addTask', { text: 'Parent' }, ANNE);
    await call(circle, 'addSubtask', { parentTaskId: p.task.id, text: 'Child' }, ANNE);

    const force = circle.agent.skills.get('bot.forceComplete');
    const denied = await force.handler({
      parts: [{ type: 'DataPart', data: { id: p.task.id, reason: 'r' } }],
      from: KID, agent: circle.agent, envelope: null,
    });
    expect(denied.text).toMatch(/admin/);

    const ok = await force.handler({
      parts: [{ type: 'DataPart', data: { id: p.task.id, reason: 'project cancelled' } }],
      from: ANNE, agent: circle.agent, envelope: null,
    });
    expect(ok.text).toMatch(/Force-completed/);
    const closed = await circle.itemStore.getById(p.task.id);
    expect(closed.completedAt).toBeGreaterThan(0);
  });

  it('bot.listProposals returns empty-state when nothing waiting', async () => {
    const list = circle.agent.skills.get('bot.listProposals');
    const r = await list.handler({ parts: [], from: KID, agent: circle.agent, envelope: null });
    expect(r.text).toMatch(/No subtask-proposals/i);
  });
});
