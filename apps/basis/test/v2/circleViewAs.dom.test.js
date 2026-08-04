// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderCircleViewAs } from '../../web/v2/circleViewAs.js';

const t = (k) => k;
function mount() { const el = document.createElement('div'); document.body.appendChild(el); return el; }

// `realName` is RELEASE-sourced (the member's own per-circle disclosure); `released` states the
// fact — revealing is the discloser's act, never a viewer preference.
const members = [
  { id: 'me',  handle: 'Owl', realName: 'Frits', released: true },
  { id: 'bob', handle: 'Fox', realName: 'Bob',   released: true },
];

describe('renderCircleViewAs', () => {
  it('renders a viewer chip per member + stranger + agent', () => {
    const el = mount();
    renderCircleViewAs(el, { members, policy: 'pairwise', viewer: { kind: 'stranger' }, t });
    const chips = el.querySelectorAll('.circle-viewas__viewer');
    expect(chips).toHaveLength(4); // me, bob, stranger, agent
    expect(el.querySelector('.circle-viewas__viewer[data-kind=stranger]')).not.toBeNull();
    expect(el.querySelector('.circle-viewas__viewer[data-kind=agent]')).not.toBeNull();
  });

  it('as a stranger, every row shows the handle + hidden badge', () => {
    const el = mount();
    renderCircleViewAs(el, { members, policy: 'open', viewer: { kind: 'stranger' }, t });
    const names = [...el.querySelectorAll('.circle-viewas__name')].map((n) => n.textContent);
    expect(names).toEqual(['Owl', 'Fox']);
    expect([...el.querySelectorAll('.circle-viewas__row')].every((r) => r.dataset.revealed === 'false')).toBe(true);
  });

  it('as member "me" under pairwise, bob RELEASED his name here → rendered with real name', () => {
    const el = mount();
    renderCircleViewAs(el, { members, policy: 'pairwise', viewer: { id: 'me', kind: 'member' }, t });
    const bobRow = el.querySelector('.circle-viewas__row[data-member-id=bob]');
    expect(bobRow.querySelector('.circle-viewas__name').textContent).toBe('Bob');
    expect(bobRow.dataset.revealed).toBe('true');
  });

  it('clicking a viewer chip fires onPickViewer with id+kind', () => {
    const el = mount();
    const onPickViewer = vi.fn();
    renderCircleViewAs(el, { members, policy: 'open', viewer: { kind: 'stranger' }, t, onPickViewer });
    el.querySelector('.circle-viewas__viewer[data-viewer-id=me]').click();
    expect(onPickViewer).toHaveBeenCalledWith({ id: 'me', kind: 'member' });
  });

  it('shows the empty state when there are no members', () => {
    const el = mount();
    renderCircleViewAs(el, { members: [], viewer: { kind: 'stranger' }, t });
    expect(el.querySelector('.circle-viewas__empty').textContent).toBe('circle.viewAs.empty');
  });

  it('onBack fires from the back button', () => {
    const el = mount();
    const onBack = vi.fn();
    renderCircleViewAs(el, { members, viewer: { kind: 'stranger' }, t, onBack });
    el.querySelector('.circle-viewas__back').click();
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
