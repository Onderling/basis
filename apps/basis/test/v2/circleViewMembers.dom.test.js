// @vitest-environment happy-dom
//
// G16 — the real MEMBERS (members) tab: the circle view lists the circle's trail-roster
// (the canonical Member via normalizeCircleMembers) as tappable rows, badges the
// viewer's own row, and a tap reaches the host (which opens the §2 card). Replaces the
// tab-coming placeholder for the members tab.
import { describe, it, expect, vi } from 'vitest';
import { renderCircleView } from '../../web/v2/circleView.js';

const t = (key, params) => (params && params.count != null ? `${key}:${params.count}` : key);

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

const circle = { id: 'circle', name: 'Circle' };
const tabs = [{ id: 'conversation', label: 'Conversation' }, { id: 'members', label: 'Members' }];
// Neither member RELEASED a name to this circle (`realName` is release-sourced, so it is null);
// each holds their own name only locally (`ownDisplayName`), which reaches nobody but the
// member's own row — the viewer still sees THEIR OWN name via that self-row fallback.
const members = [
  { id: 'me',  handle: 'Owl', realName: null, released: false, ownDisplayName: 'Frits' },
  { id: 'bob', handle: 'Fox', realName: null, released: false, ownDisplayName: 'Bob' },
];

describe('renderCircleView · MEMBERS tab', () => {
  it('renders one tappable row per roster member (not the tab-coming placeholder)', () => {
    const el = mount();
    renderCircleView(el, { circle, rows: [], tabs, activeTab: 'members', members, selfWebid: 'me', t });

    expect(el.querySelector('.circle-view__placeholder')).toBeNull();
    const rows = el.querySelectorAll('.circle-view__member');
    expect(rows.length).toBe(2);
    expect(rows[0].dataset.memberId).toBe('me');
    expect(rows[0].querySelector('.circle-view__member-primary').textContent).toBe('@Owl');
    expect(rows[0].querySelector('.circle-view__member-secondary').textContent).toBe('Frits');
  });

  it('badges the viewer\'s own row', () => {
    const el = mount();
    renderCircleView(el, { circle, rows: [], tabs, activeTab: 'members', members, selfWebid: 'me', t });
    const mine = el.querySelector('.circle-view__member--self');
    expect(mine).not.toBeNull();
    expect(mine.dataset.memberId).toBe('me');
    expect(mine.querySelector('.circle-view__member-you').textContent).toBe('circle.members_tab.you');
    // the other member's row is not badged.
    const others = [...el.querySelectorAll('.circle-view__member')].filter((r) => !r.classList.contains('circle-view__member--self'));
    expect(others).toHaveLength(1);
    expect(others[0].querySelector('.circle-view__member-you')).toBeNull();
  });

  it('a member-row tap reaches the host with the tapped member', () => {
    const el = mount();
    const onMemberTap = vi.fn();
    renderCircleView(el, { circle, rows: [], tabs, activeTab: 'members', members, selfWebid: 'me', onMemberTap, t });
    el.querySelector('[data-member-id="bob"]').click();
    expect(onMemberTap).toHaveBeenCalledTimes(1);
    expect(onMemberTap.mock.calls[0][0]).toMatchObject({ id: 'bob', handle: 'Fox' });
  });

  it('shows a loading state when the roster is not loaded yet (members == null)', () => {
    const el = mount();
    renderCircleView(el, { circle, rows: [], tabs, activeTab: 'members', members: null, t });
    expect(el.querySelector('.circle-view__members-loading').textContent).toBe('circle.members_tab.loading');
    expect(el.querySelector('.circle-view__member')).toBeNull();
  });

  it('shows an empty state when the roster loaded empty', () => {
    const el = mount();
    renderCircleView(el, { circle, rows: [], tabs, activeTab: 'members', members: [], t });
    expect(el.querySelector('.circle-view__members-empty').textContent).toBe('circle.members_tab.empty');
  });
});
