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

  // ── HOW someone is an admin, on the row itself ──────────────────────────────────────────────
  // Three ways in, one word until now. The caretaker — nobody asked them, the circle was simply
  // left without an admin — is the one that must not read like a promotion.
  describe('the admin badge + how it was come by', () => {
    const withAdmins = [
      { id: 'me', handle: 'Owl', realName: null, released: false, ownDisplayName: 'Frits',
        role: 'admin', admin: { via: 'founder', labelKey: 'circle.admin_via.founder' } },
      { id: 'bob', handle: 'Fox', realName: null, released: false, ownDisplayName: 'Bob',
        role: 'admin', admin: { via: 'appointed', labelKey: 'circle.admin_via.appointed' } },
      { id: 'cato', handle: 'Heron', realName: null, released: false, ownDisplayName: 'Cato',
        role: 'admin', admin: { via: 'caretaker', labelKey: 'circle.admin_via.caretaker', appointment: 'h1' } },
      { id: 'dana', handle: 'Wren', realName: null, released: false, ownDisplayName: 'Dana' },
    ];
    const rowFor = (el, id) => el.querySelector(`[data-member-id="${id}"]`);

    it('every admin is badged, and each of the three reads DIFFERENTLY', () => {
      const el = mount();
      renderCircleView(el, { circle, rows: [], tabs, activeTab: 'members', members: withAdmins, selfWebid: 'me', t });
      const via = (id) => rowFor(el, id).querySelector('.circle-view__member-via');
      expect(rowFor(el, 'me').querySelector('.circle-view__member-role').textContent).toBe('circle.admin.role.admin');
      expect(via('me').textContent).toBe('circle.admin_via.founder');
      expect(via('bob').textContent).toBe('circle.admin_via.appointed');
      expect(via('cato').textContent).toBe('circle.admin_via.caretaker');
      // the three labels are three, not one — the failure this whole line exists to fix
      expect(new Set([via('me').textContent, via('bob').textContent, via('cato').textContent]).size).toBe(3);
      // …and the caretaker is distinguishable structurally too, not only by its words
      expect(via('cato').dataset.adminVia).toBe('caretaker');
      expect(via('cato').className).toContain('circle-view__member-via--caretaker');
      expect(via('bob').className).not.toContain('circle-view__member-via--caretaker');
    });

    it('a plain member carries no badge and no clause', () => {
      const el = mount();
      renderCircleView(el, { circle, rows: [], tabs, activeTab: 'members', members: withAdmins, selfWebid: 'me', t });
      expect(rowFor(el, 'dana').querySelector('.circle-view__member-role')).toBeNull();
      expect(rowFor(el, 'dana').querySelector('.circle-view__member-via')).toBeNull();
    });

    it('an admin the projection cannot explain keeps the badge and borrows no reason', () => {
      const el = mount();
      const unexplained = [{ id: 'eve', handle: 'Elk', realName: null, released: false, role: 'admin' }];
      renderCircleView(el, { circle, rows: [], tabs, activeTab: 'members', members: unexplained, selfWebid: 'me', t });
      expect(rowFor(el, 'eve').querySelector('.circle-view__member-role').textContent).toBe('circle.admin.role.admin');
      expect(rowFor(el, 'eve').querySelector('.circle-view__member-via')).toBeNull();
    });
  });

  it('shows an empty state when the roster loaded empty', () => {
    const el = mount();
    renderCircleView(el, { circle, rows: [], tabs, activeTab: 'members', members: [], t });
    expect(el.querySelector('.circle-view__members-empty').textContent).toBe('circle.members_tab.empty');
  });
});
