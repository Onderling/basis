// @vitest-environment happy-dom
//
// Governance panel render (Phase 4 §5 L4 slice 3): the web view over buildGovernanceView.
// A member-vote proposal renders its tally + vote buttons (wired to onVote); an admin past
// the deadline gets an override button; a closed proposal shows in history, not as votable.
import { describe, it, expect, vi } from 'vitest';
import { renderGovernancePanel } from '../../web/v2/circleGovernancePanel.js';
import { buildGovernanceView } from '../../src/v2/governanceView.js';
import { foldGovernance, proposeEvent, voteEvent, resolveEvent } from '../../src/v2/governanceLog.js';
import { normalizeCirclePolicy } from '../../src/v2/circlePolicy.js';
import { DECISION_STATUS } from '../../src/v2/governanceDecision.js';

const members5 = [
  { ref: 'admin0', role: 'admin' },
  { ref: 'm0', role: 'member' }, { ref: 'm1', role: 'member' },
  { ref: 'm2', role: 'member' }, { ref: 'm3', role: 'member' },
];
const POL = normalizeCirclePolicy({ governance: { removeMember: 'member-vote' } });
const viewFor = (events, viewer, now = 50) =>
  buildGovernanceView({ fold: foldGovernance(events, { policy: POL, members: members5, now }), viewer, labelForSubject: (s) => `lid ${s}` });

describe('renderGovernancePanel', () => {
  it('renders an open member-vote with tally + vote buttons, and fires onVote', () => {
    const c = document.createElement('div');
    const onVote = vi.fn();
    const view = viewFor([
      proposeEvent({ proposalId: 'p1', action: 'removeMember', subject: 'm3', by: 'admin0', deadline: 100, at: 1 }),
      voteEvent({ proposalId: 'p1', voter: 'm0', choice: 'yes', at: 2 }),
    ], { ref: 'm1', role: 'member' });
    renderGovernancePanel(c, { view, t: (k, p) => (p ? `${k}:${JSON.stringify(p)}` : k), onVote });

    expect(c.querySelector('.circle-governance__card')).toBeTruthy();
    expect(c.textContent).toContain('circle.governance.action.removeMember');
    expect(c.textContent).toContain('lid m3');
    const yes = c.querySelector('.circle-governance__vote--yes');
    expect(yes).toBeTruthy();
    yes.click();
    expect(onVote).toHaveBeenCalledWith('p1', 'yes');
  });

  it("marks the viewer's own vote", () => {
    const c = document.createElement('div');
    const view = viewFor([
      proposeEvent({ proposalId: 'p1', action: 'removeMember', subject: 'm3', by: 'admin0', deadline: 100, at: 1 }),
      voteEvent({ proposalId: 'p1', voter: 'm0', choice: 'yes', at: 2 }),
    ], { ref: 'm0', role: 'member' });
    renderGovernancePanel(c, { view, t: (k) => k });
    expect(c.querySelector('.circle-governance__vote--yes.is-mine')).toBeTruthy();
  });

  it('shows an override button to an admin past the deadline, wired to onOverride', () => {
    const c = document.createElement('div');
    const onOverride = vi.fn();
    const view = viewFor([
      proposeEvent({ proposalId: 'p1', action: 'removeMember', subject: 'm3', by: 'admin0', deadline: 100, at: 1 }),
      voteEvent({ proposalId: 'p1', voter: 'm0', choice: 'yes', at: 2 }),
    ], { ref: 'admin0', role: 'admin' }, 200); // past the deadline
    renderGovernancePanel(c, { view, t: (k) => k, onOverride });
    const ob = c.querySelector('.circle-governance__override');
    expect(ob).toBeTruthy();
    ob.click();
    expect(onOverride).toHaveBeenCalledWith('p1');
  });

  it('a member never sees an override button', () => {
    const c = document.createElement('div');
    const view = viewFor([
      proposeEvent({ proposalId: 'p1', action: 'removeMember', subject: 'm3', by: 'admin0', deadline: 100, at: 1 }),
    ], { ref: 'm0', role: 'member' }, 200);
    renderGovernancePanel(c, { view, t: (k) => k });
    expect(c.querySelector('.circle-governance__override')).toBeNull();
  });

  it('empty state when there are no open proposals', () => {
    const c = document.createElement('div');
    renderGovernancePanel(c, { view: { open: [], closed: [] }, t: (k) => k });
    expect(c.querySelector('.circle-governance__empty')).toBeTruthy();
    expect(c.querySelector('.circle-governance__card')).toBeNull();
  });

  it('admin-only decision-class settings render and fire onSetClass on change', () => {
    const c = document.createElement('div');
    const onSetClass = vi.fn();
    const policy = normalizeCirclePolicy({ governance: { removeMember: 'member-vote' } });
    renderGovernancePanel(c, { view: { open: [], closed: [] }, t: (k) => k, policy, isAdmin: true, onSetClass });
    const settings = c.querySelector('.circle-governance__settings');
    expect(settings).toBeTruthy();
    const removeRow = c.querySelector('.circle-governance__setting[data-action="removeMember"]');
    expect(removeRow).toBeTruthy();
    const select = removeRow.querySelector('select');
    expect(select.value).toBe('member-vote');           // reflects the current policy
    select.value = 'any-admin';
    select.dispatchEvent(new window.Event('change'));
    expect(onSetClass).toHaveBeenCalledWith('removeMember', 'any-admin');
  });

  it('a non-admin never sees the settings control', () => {
    const c = document.createElement('div');
    renderGovernancePanel(c, { view: { open: [], closed: [] }, t: (k) => k, policy: normalizeCirclePolicy({}), isAdmin: false, onSetClass: () => {} });
    expect(c.querySelector('.circle-governance__settings')).toBeNull();
  });

  it('a closed proposal appears in history, not as a votable card', () => {
    const c = document.createElement('div');
    const view = viewFor([
      proposeEvent({ proposalId: 'p1', action: 'removeMember', subject: 'm3', by: 'admin0', at: 1 }),
      resolveEvent({ proposalId: 'p1', status: DECISION_STATUS.APPROVED, by: 'admin0', at: 9 }),
    ], { ref: 'm0', role: 'member' });
    renderGovernancePanel(c, { view, t: (k) => k });
    expect(c.querySelector('.circle-governance__card')).toBeNull();       // not open
    expect(c.querySelector('.circle-governance__history')).toBeTruthy();  // in history
    expect(c.querySelector('.circle-governance__closed')).toBeTruthy();
  });
});
