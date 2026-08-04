// @vitest-environment happy-dom
//
// §2 — the two LEDEN-tab card views: member-persona ("what this member reveals to me")
// and self-view ("how others see me"). Thin DOM projectors over the shared
// memberCards.js splits — these assert the sees/hides columns render + the self-view
// viewer picker reaches the host.
import { describe, it, expect, vi } from 'vitest';
import { renderMemberPersonaCard, renderSelfViewCard } from '../../web/v2/circleMemberCard.js';
import { memberPersonaView, selfViewSplit } from '../../src/v2/memberCards.js';

const t = (key) => key;

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

// `realName` is RELEASE-sourced (the member's own per-circle disclosure); `released` states the
// fact. Carol holds a name locally (`ownDisplayName`) but released nothing — revealing is the
// discloser's act, so nobody but Carol may see it.
const me    = { id: 'me',    handle: 'Owl',   realName: 'Frits', released: true };
const bob   = { id: 'bob',   handle: 'Fox',   realName: 'Bob',   released: true };
const carol = { id: 'carol', handle: 'Heron', realName: null,    released: false, ownDisplayName: 'Carol' };

describe('renderMemberPersonaCard', () => {
  it('splits the member into visible / hidden columns (carol released no name → hidden)', () => {
    const el = mount();
    const split = memberPersonaView({ member: carol, viewerWebid: 'me', policy: 'pairwise' });
    renderMemberPersonaCard(el, { member: carol, split, t });

    const seen = el.querySelector('.circle-membercard__col--sees');
    const hidden = el.querySelector('.circle-membercard__col--hides');
    // handle visible, real name hidden.
    expect(seen.querySelector('[data-attr="handle"] .circle-membercard__attr-value').textContent).toBe('@Heron');
    expect(hidden.querySelector('[data-attr="realName"]')).not.toBeNull();
    expect(hidden.querySelector('[data-attr="realName"] .circle-membercard__attr-value').textContent)
      .toBe('circle.memberCard.hidden_marker');
    // the title reads legibly — the handle (real name is hidden from me).
    expect(el.querySelector('.circle-membercard__title').textContent).toBe('@Heron');
  });

  it('shows the real name for a member who RELEASED their name to this circle', () => {
    const el = mount();
    const split = memberPersonaView({ member: bob, viewerWebid: 'me', policy: 'pairwise' });
    renderMemberPersonaCard(el, { member: bob, split, t });
    const seen = el.querySelector('.circle-membercard__col--sees');
    expect(seen.querySelector('[data-attr="realName"] .circle-membercard__attr-value').textContent).toBe('Bob');
    expect(el.querySelector('.circle-membercard__col--hides .circle-membercard__none')).not.toBeNull();
    expect(el.querySelector('.circle-membercard__title').textContent).toBe('Bob');
  });

  it('surfaces the C7 amount preset badge (full when the real name shows, handle when it does not)', () => {
    const shown = mount();
    renderMemberPersonaCard(shown, { member: bob, split: memberPersonaView({ member: bob, viewerWebid: 'me' }), t });
    const badgeShown = shown.querySelector('.circle-membercard__preset');
    expect(badgeShown).not.toBeNull();
    expect(badgeShown.dataset.preset).toBe('full');
    expect(badgeShown.querySelector('.circle-membercard__preset-value').textContent).toBe('circle.reveal.preset.full');

    const hidden = mount();
    renderMemberPersonaCard(hidden, { member: carol, split: memberPersonaView({ member: carol, viewerWebid: 'me' }), t });
    expect(hidden.querySelector('.circle-membercard__preset').dataset.preset).toBe('handle');
  });

  it('back reaches the host', () => {
    const el = mount();
    const onBack = vi.fn();
    renderMemberPersonaCard(el, { member: bob, split: memberPersonaView({ member: bob, viewerWebid: 'me' }), t, onBack });
    el.querySelector('.circle-membercard__back').click();
    expect(onBack).toHaveBeenCalledOnce();
  });
});

describe('renderSelfViewCard', () => {
  it('renders a viewer picker (other members + stranger + agent) and marks the active one', () => {
    const el = mount();
    const viewer = { kind: 'stranger' };
    renderSelfViewCard(el, {
      me, members: [bob, carol], viewer,
      split: selfViewSplit({ me, viewer, policy: 'open' }), t,
    });
    const chips = el.querySelectorAll('.circle-membercard__viewer');
    // bob + carol + stranger + agent = 4 (my own row is excluded from the picker).
    expect(chips.length).toBe(4);
    const active = el.querySelector('.circle-membercard__viewer.is-active');
    expect(active.dataset.kind).toBe('stranger');
    // a stranger sees only my handle.
    expect(el.querySelector('.circle-membercard__col--sees [data-attr="handle"]')).not.toBeNull();
    expect(el.querySelector('.circle-membercard__col--hides [data-attr="realName"]')).not.toBeNull();
    // …and the reveal-state badge floors at the handle preset for a stranger.
    expect(el.querySelector('.circle-membercard__preset').dataset.preset).toBe('handle');
  });

  it('picking a viewer reaches the host', () => {
    const el = mount();
    const onPickViewer = vi.fn();
    const viewer = { kind: 'stranger' };
    renderSelfViewCard(el, {
      me, members: [bob], viewer,
      split: selfViewSplit({ me, viewer }), t, onPickViewer,
    });
    el.querySelector('[data-viewer-id="bob"]').click();
    expect(onPickViewer).toHaveBeenCalledWith({ id: 'bob', kind: 'member' });
  });
});
