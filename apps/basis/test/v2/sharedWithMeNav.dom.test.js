// @vitest-environment happy-dom
/**
 * SILENT out-of-circle delivery — the NAV ENTRY that opens the "shared with me" view.
 *
 * The view (renderSharedWithMe) + selector (buildSharedWithMe) already existed; this proves the
 * missing piece — a personal, cross-circle NAV entry that OPENS that view fed with the per-user
 * store's entries. Placement: one of the doors behind My data (declared once in `myDataDoors.js`),
 * peer of availability and blocked — Mij keeps one door, My data. web ≡ mobile: the web adapter reads the store
 * and projects through the SAME `buildSharedWithMe` the mobile SharedWithMeScreen runs internally.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleMyData } from '../../web/v2/circleMyData.js';
import { renderSharedWithMe } from '../../web/v2/sharedWithMe.js';
import { buildSharedWithMe } from '../../src/v2/sharedWithMe.js';

function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }
const tagT = (k) => `T:${k}`;

describe('shared-with-me nav entry (a door behind My data)', () => {
  it('renders the entry only when onSharedWithMe is wired, labelled via t()', () => {
    const without = mount();
    renderCircleMyData(without, { t: tagT });
    expect(without.querySelector('.cc-profile__shared-with-me')).toBeNull();

    const withEntry = mount();
    renderCircleMyData(withEntry, { t: tagT, doors: { 'shared-with-me': () => {} } });
    const btn = withEntry.querySelector('.cc-profile__shared-with-me');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toBe('T:circle.profile.sharedWithMe');
  });

  it('invokes the handler on click', () => {
    const el = mount();
    const onSharedWithMe = vi.fn();
    renderCircleMyData(el, { t: tagT, doors: { 'shared-with-me': onSharedWithMe } });
    el.querySelector('.cc-profile__shared-with-me').click();
    expect(onSharedWithMe).toHaveBeenCalledTimes(1);
  });

  it('OPENS the shared-with-me view fed the store entries when the entry is tapped', () => {
    // The per-user store's raw entries (as sharedWithMeStore.list() returns them).
    const received = [
      { id: 'a', sealed: { id: 'a', text: 'x' }, itemMeta: { sourceType: 'note' }, from: 'alice', receivedAt: 100 },
      { id: 'b', sealed: { id: 'b', text: 'y' }, itemMeta: { sourceType: 'task' }, from: 'bob',   receivedAt: 300 },
    ];
    const root = mount();
    // The host wiring showMyData performs: tapping the entry projects the store list through the
    // SHARED selector and renders the view into the same root.
    const openSharedWithMe = () => renderSharedWithMe(root, { entries: buildSharedWithMe(received), t: tagT });
    renderCircleMyData(root, { t: tagT, doors: { 'shared-with-me': openSharedWithMe } });

    // Before: My data is showing, no shared-with-me surface yet.
    expect(root.classList.contains('shared-with-me')).toBe(false);
    expect(root.querySelector('.cc-profile__shared-with-me')).not.toBeNull();
    root.querySelector('.cc-profile__shared-with-me').click();

    // After: the shared-with-me view replaced the profile in the same root, newest-first,
    // over the shared projection (renderSharedWithMe tags the container itself).
    expect(root.classList.contains('shared-with-me')).toBe(true);
    expect(root.querySelector('.cc-profile__shared-with-me')).toBeNull();   // My data gone
    expect(root.querySelector('.shared-with-me__title').textContent).toBe('T:circle.sharedWithMe.title');
    const rows = [...root.querySelectorAll('.shared-with-me__row')];
    expect(rows.map((r) => r.dataset.copyId)).toEqual(['b', 'a']);   // newest-first
    expect(rows[0].textContent).toBe('T:circle.sharedWithMe.row');   // projected row shape
    // Back affordance returns to My data (host wires onBack: showMyData).
    expect(root.querySelector('.shared-with-me__back')).not.toBeNull();
  });

  it('shows the empty state when nothing has been shared', () => {
    const root = mount();
    renderSharedWithMe(root, { entries: buildSharedWithMe([]), t: tagT });
    expect(root.querySelector('.shared-with-me__empty').textContent).toBe('T:circle.sharedWithMe.empty');
    expect(root.querySelector('.shared-with-me__row')).toBeNull();
  });
});
