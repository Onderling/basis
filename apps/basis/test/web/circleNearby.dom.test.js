// @vitest-environment happy-dom
/**
 * Nearby screen, web surface (Nearby step E).
 *
 * The renderer is a projector — the interesting decisions were made by `createNearbyScreen` and arrive on
 * the model. What these pin is that the projector does not LOSE them:
 *
 *   • the visibility banner shows what the device is doing, and shouts when that disagrees with the ask;
 *   • row actions come from the model, so web cannot offer a stranger something mobile would not;
 *   • every string goes through `t()` (invariant 8) — no hardcoded English in the DOM.
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleNearby } from '../../web/v2/circleNearby.js';

/** Return the key itself, so a hardcoded string is immediately visible in an assertion. */
const t = (k) => k;

const model = (over = {}) => ({
  rows: [], counts: { total: 0, sharingAny: 0 },
  ownProfile: { pseudonym: 'ik', publishedSkills: [] },
  headerLabel: '0 of 0 share offerings with you',
  ...over,
});

const row = (over = {}) => ({
  id: 'peer-1', pseudonym: 'iemand', source: 'mdns', proximity: null,
  sharedSkills: [], allSkills: [], sharesAny: false, lastSeen: null,
  actions: [], isMember: false, note: 'nearby-not-member', ...over,
});

function render(m, opts = {}) {
  const el = document.createElement('div');
  renderCircleNearby(el, { model: m, t, ...opts });
  return el;
}

describe('the visibility banner', () => {
  it('says VISIBLE while announcing', () => {
    const el = render(model({ visibility: { publishing: true, degraded: false, unavailable: false } }));
    const banner = el.querySelector('.circle-nearby__visibility');
    expect(banner.dataset.visibility).toBe('visible');
    expect(banner.textContent).toContain('circle.nearbyScreen.visible_title');
    expect(banner.textContent).toContain('circle.nearbyScreen.visible_body');
  });

  it('says HIDDEN in ghost mode', () => {
    const el = render(model({ visibility: { publishing: false, degraded: false, unavailable: false } }));
    expect(el.querySelector('.circle-nearby__visibility').dataset.visibility).toBe('hidden');
  });

  it('THE ONE THAT MATTERS: degraded outranks everything and is announced to a screen reader', () => {
    // Asked to be hidden, still publishing. If this ever renders as "hidden", someone is misled about
    // whether a café full of strangers can see them.
    const el = render(model({ visibility: { publishing: true, degraded: true, unavailable: false } }));
    const banner = el.querySelector('.circle-nearby__visibility');
    expect(banner.dataset.visibility).toBe('still_visible');
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('circle.nearbyScreen.still_visible_title');
  });

  it('UNAVAILABLE is not an alert — a laptop with no radio is not a privacy failure', () => {
    const el = render(model({ visibility: { publishing: false, degraded: false, unavailable: true } }));
    const banner = el.querySelector('.circle-nearby__visibility');
    expect(banner.dataset.visibility).toBe('unavailable');
    expect(banner.getAttribute('role')).toBeNull();
  });

  it('renders no banner when the model carries no visibility (old caller)', () => {
    expect(render(model()).querySelector('.circle-nearby__visibility')).toBeNull();
  });
});

describe('row actions', () => {
  it('renders the actions the model decided, and nothing else', () => {
    const el = render(model({ rows: [row({ actions: ['invite-to-circle', 'request-join'] })] }));
    const labels = [...el.querySelectorAll('.circle-nearby__action')].map((b) => b.dataset.action);
    expect(labels).toEqual(['invite-to-circle', 'request-join']);
    expect(el.querySelector('.circle-nearby__action--invite-to-circle').textContent)
      .toBe('circle.nearbyScreen.action_invite');
  });

  it('a stranger is LABELLED a stranger, not just missing a button', () => {
    const el = render(model({ rows: [row({ note: 'nearby-not-member' })] }));
    expect(el.querySelector('.circle-nearby__note').textContent)
      .toBe('circle.nearbyScreen.not_member_note');
  });

  it('a member gets no stranger note', () => {
    const el = render(model({ rows: [row({ isMember: true, note: null, actions: ['open-shared-circle'] })] }));
    expect(el.querySelector('.circle-nearby__note')).toBeNull();
    expect(el.querySelector('.circle-nearby__action--open-shared-circle')).toBeTruthy();
  });

  it('an action the renderer does not recognise is SKIPPED, never shown raw', () => {
    // Otherwise a new action id from shared code leaks an internal identifier into the UI.
    const el = render(model({ rows: [row({ actions: ['some-future-action', 'request-join'] })] }));
    const shown = [...el.querySelectorAll('.circle-nearby__action')].map((b) => b.dataset.action);
    expect(shown).toEqual(['request-join']);
  });

  it('clicking reports the action and the row', () => {
    const onAction = vi.fn();
    const r = row({ actions: ['request-join'] });
    const el = render(model({ rows: [r] }), { onAction });
    el.querySelector('.circle-nearby__action').click();
    expect(onAction).toHaveBeenCalledWith('request-join', expect.objectContaining({ id: 'peer-1' }));
  });

  it('no actions ⇒ no action bar at all', () => {
    const el = render(model({ rows: [row({ actions: [] })] }));
    expect(el.querySelector('.circle-nearby__actions')).toBeNull();
  });
});

describe('invariant 8 — every string is translated', () => {
  it('renders no hardcoded English anywhere on the screen', () => {
    const el = render(model({
      rows: [row({ actions: ['invite-to-circle', 'request-join', 'open-shared-circle'], sharedSkills: ['soep'] })],
      visibility: { publishing: true, degraded: true, unavailable: false },
      ownProfile: { pseudonym: 'ik', publishedSkills: [] },
    }));
    // With t = identity, anything user-visible is either a locale KEY or model-supplied data.
    const strings = [...el.querySelectorAll('button, .circle-nearby__visibility-title, .circle-nearby__visibility-body, .circle-nearby__note, .circle-nearby__own-title, .circle-nearby__own-skills')]
      .map((n) => n.textContent.trim())
      .filter(Boolean);
    for (const s of strings) {
      expect(s.startsWith('circle.'), `untranslated string in the DOM: "${s}"`).toBe(true);
    }
  });

  it('the empty state and own-profile footer still render', () => {
    const el = render(model());
    expect(el.querySelector('.circle-nearby__empty').textContent).toBe('circle.nearbyScreen.header_empty');
    expect(el.querySelector('.circle-nearby__own-skills').textContent)
      .toBe('circle.nearbyScreen.own_profile_empty');
  });

  it('back still works', () => {
    const onBack = vi.fn();
    const el = render(model(), { onBack });
    el.querySelector('.circle-nearby__back').click();
    expect(onBack).toHaveBeenCalled();
  });
});

describe('asks in the room (step F)', () => {
  const askEntry = (over = {}) => ({
    ask: { id: 'ask-1', text: 'anyone got a bike pump?', tags: ['fiets'] },
    resonant: false, reason: null, actions: ['answer-ask', 'dismiss-ask'], note: null, ...over,
  });

  it('renders every live ask, matching or not', () => {
    // Filtering the room to what resonates would make it a recommender AND leak my drivers into what I see.
    const el = render(model({ asks: [askEntry(), askEntry({ ask: { id: 'ask-2', text: 'wifi code?' } })] }));
    expect(el.querySelectorAll('.circle-nearby__ask')).toHaveLength(2);
  });

  it('marks a resonant ask and names the SHARED reason', () => {
    const el = render(model({ asks: [askEntry({ resonant: true, reason: 'you both care about: fiets' })] }));
    const ask = el.querySelector('.circle-nearby__ask');
    expect(ask.classList.contains('is-resonant')).toBe(true);
    expect(ask.querySelector('.circle-nearby__ask-reason').textContent)
      .toBe('circle.nearbyScreen.ask_resonant');
  });

  it('THE LOAD-BEARING LINE: every ask says that only answering reveals you', () => {
    // If this ever renders conditionally, someone answers without knowing what it costs.
    const el = render(model({ asks: [askEntry(), askEntry({ resonant: true, reason: 'x', ask: { id: 'a2', text: 'y' } })] }));
    const notes = [...el.querySelectorAll('.circle-nearby__ask-disclosure')];
    expect(notes).toHaveLength(2);
    expect(notes[0].textContent).toBe('circle.nearbyScreen.ask_disclosure');
  });

  it('answer + dismiss are offered, and clicking reports the ask', () => {
    const onAskAction = vi.fn();
    const el = render(model({ asks: [askEntry()] }), { onAskAction });
    const actions = [...el.querySelectorAll('.circle-nearby__ask-action')].map((b) => b.dataset.action);
    expect(actions).toEqual(['answer-ask', 'dismiss-ask']);

    el.querySelector('.circle-nearby__ask-action--answer-ask').click();
    expect(onAskAction).toHaveBeenCalledWith('answer-ask', expect.objectContaining({ id: 'ask-1' }));
  });

  it('an unknown ask action is skipped rather than shown raw', () => {
    const el = render(model({ asks: [askEntry({ actions: ['notify-asker', 'dismiss-ask'] })] }));
    const actions = [...el.querySelectorAll('.circle-nearby__ask-action')].map((b) => b.dataset.action);
    expect(actions).toEqual(['dismiss-ask']);
  });

  it('an expired ask (no actions) renders no action bar', () => {
    const el = render(model({ asks: [askEntry({ actions: [] })] }));
    expect(el.querySelector('.circle-nearby__ask-actions')).toBeNull();
  });

  it('the compose button is always available, even in an empty room', () => {
    const onCompose = vi.fn();
    const el = render(model({ asks: [] }), { onCompose });
    expect(el.querySelector('.circle-nearby__asks-empty').textContent)
      .toBe('circle.nearbyScreen.asks_empty');
    el.querySelector('.circle-nearby__ask-compose').click();
    expect(onCompose).toHaveBeenCalled();
  });

  it('still no untranslated strings once asks are on screen', () => {
    const el = render(model({ asks: [askEntry({ resonant: true, reason: 'you both care about: fiets' })] }));
    const strings = [...el.querySelectorAll('.circle-nearby__asks-title, .circle-nearby__ask-compose, .circle-nearby__ask-reason, .circle-nearby__ask-disclosure, .circle-nearby__ask-action')]
      .map((n) => n.textContent.trim()).filter(Boolean);
    for (const s of strings) {
      expect(s.startsWith('circle.'), `untranslated: "${s}"`).toBe(true);
    }
  });
});

describe('the ask composer', () => {
  it('shows the compose button when closed, and the input when open', () => {
    expect(render(model({ asks: [] })).querySelector('.circle-nearby__ask-form')).toBeNull();

    const el = render(model({ asks: [] }), { composing: true });
    expect(el.querySelector('.circle-nearby__ask-input').placeholder)
      .toBe('circle.nearbyScreen.ask_placeholder');
    expect(el.querySelector('.circle-nearby__ask-compose')).toBeNull();
  });

  it('the room stays visible while composing — you can see who is standing there', () => {
    const el = render(model({
      asks: [{ ask: { id: 'a1', text: 'wifi code?' }, resonant: false, actions: [] }],
    }), { composing: true });
    expect(el.querySelector('.circle-nearby__ask-form')).toBeTruthy();
    expect(el.querySelectorAll('.circle-nearby__ask')).toHaveLength(1);
  });

  it('submitting reports the text; an empty submit does nothing', () => {
    const onSubmitAsk = vi.fn();
    const el = render(model(), { composing: true, onSubmitAsk });
    const form = el.querySelector('.circle-nearby__ask-form');
    const input = el.querySelector('.circle-nearby__ask-input');

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSubmitAsk).not.toHaveBeenCalled();     // nothing typed → nothing said

    input.value = '  anyone got a pump?  ';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSubmitAsk).toHaveBeenCalledWith('anyone got a pump?');
  });

  it('caps the input at the ask length so the limit is felt, not discovered', () => {
    const el = render(model(), { composing: true });
    expect(el.querySelector('.circle-nearby__ask-input').maxLength).toBe(280);
  });

  it('the notice names the REAL reach, and is announced', () => {
    const el = render(model(), { notice: { key: 'ask_sent', vars: { sent: 3, peers: 5 } } });
    const n = el.querySelector('.circle-nearby__notice');
    expect(n.dataset.notice).toBe('ask_sent');
    expect(n.getAttribute('role')).toBe('status');
    expect(n.textContent).toBe('circle.nearbyScreen.ask_sent');
  });

  it('after answering, the notice says plainly that I am now visible', () => {
    const el = render(model(), { notice: { key: 'answer_sent' } });
    expect(el.querySelector('.circle-nearby__notice').dataset.notice).toBe('answer_sent');
  });
});

describe('cards and chat, each behind its allow (step G)', () => {
  const withAllows = (allows, over = {}) => model({ allows, ...over });

  it('both allows render as toggles, off by default', () => {
    const el = render(model());
    const boxes = [...el.querySelectorAll('.circle-nearby__allow input')];
    expect(boxes.map((b) => b.dataset.allow)).toEqual(['card', 'chat']);
    expect(boxes.every((b) => b.checked)).toBe(false);
  });

  it('an OFF allow says what OTHERS see, not what the setting is', () => {
    // "Show my card here: off" tells you the switch position. "Nobody here sees a card from you" tells you
    // the consequence, which is the thing you actually wanted to know.
    const el = render(model());
    expect(el.querySelector('.circle-nearby__allow-off--card').textContent)
      .toBe('circle.nearbyScreen.allow_card_off');
    expect(el.querySelector('.circle-nearby__allow-off--chat').textContent)
      .toBe('circle.nearbyScreen.allow_chat_off');
  });

  it('toggling reports the key and the new value', () => {
    const onToggleAllow = vi.fn();
    const el = render(model(), { onToggleAllow });
    const box = el.querySelector('.circle-nearby__allow--chat input');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(onToggleAllow).toHaveBeenCalledWith('chat', true);
  });

  it('the card composer appears only once the card allow is on', () => {
    expect(render(model()).querySelector('.circle-nearby__card-form')).toBeNull();
    expect(render(withAllows({ card: true, chat: false })).querySelector('.circle-nearby__card-form')).toBeTruthy();
  });

  it('the composer states WHO can see it, right next to the fields', () => {
    // "Everyone in this room" is not obvious from a text box.
    const el = render(withAllows({ card: true, chat: false }));
    expect(el.querySelector('.circle-nearby__card-visible').textContent)
      .toBe('circle.nearbyScreen.card_visible_to');
  });

  it('submitting a card needs a face; an empty one does nothing', () => {
    const onSubmitCard = vi.fn();
    const el = render(withAllows({ card: true, chat: false }), { onSubmitCard });
    const form = el.querySelector('.circle-nearby__card-form');

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSubmitCard).not.toHaveBeenCalled();

    el.querySelector('.circle-nearby__card-label').value = ' Sam ';
    el.querySelector('.circle-nearby__card-line-input').value = 'net verhuisd';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSubmitCard).toHaveBeenCalledWith({ label: 'Sam', line: 'net verhuisd' });
  });

  it("another person's card renders on THEIR row, even with my own allow off", () => {
    // Looking is not disclosure.
    const el = render(model({
      rows: [row({ card: { label: 'Ada', line: 'hoi', tags: ['fiets'] } })],
    }));
    expect(el.querySelector('.circle-nearby__card-line').textContent).toBe('hoi');
    expect(el.querySelector('.circle-nearby__card-tags').textContent).toBe('fiets');
    expect(el.querySelector('.circle-nearby__card-form')).toBeNull();   // mine is still not shown
  });

  it('NOT JOINED (chat: null) renders no chat at all — not an empty one', () => {
    // An empty conversation and "I am not in this conversation" are different facts.
    const el = render(model({ chat: null }));
    expect(el.querySelector('.circle-nearby__chat')).toBeNull();
  });

  it('joined but silent renders the empty state', () => {
    const el = render(model({ allows: { card: false, chat: true }, chat: [] }));
    expect(el.querySelector('.circle-nearby__chat-empty').textContent)
      .toBe('circle.nearbyScreen.chat_empty');
  });

  it('says out loud that nothing is kept', () => {
    // A chat window normally implies history; this one has none, so it has to say so.
    const el = render(model({ allows: { card: false, chat: true }, chat: [] }));
    expect(el.querySelector('.circle-nearby__chat-ephemeral').textContent)
      .toBe('circle.nearbyScreen.chat_ephemeral');
  });

  it('renders messages and sends new ones, clearing the input', () => {
    const onSay = vi.fn();
    const el = render(model({
      allows: { card: false, chat: true },
      chat: [{ id: 'm1', text: 'hoi' }, { id: 'm2', text: 'dag' }],
    }), { onSay });

    expect([...el.querySelectorAll('.circle-nearby__chat-line')].map((n) => n.textContent))
      .toEqual(['hoi', 'dag']);

    const input = el.querySelector('.circle-nearby__chat-input');
    input.value = '  hallo  ';
    el.querySelector('.circle-nearby__chat-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSay).toHaveBeenCalledWith('hallo');
    expect(input.value).toBe('');
  });

  it('no untranslated strings with cards and chat on screen', () => {
    const el = render(model({
      allows: { card: true, chat: true },
      chat: [],
      rows: [row({ card: { label: 'Ada', line: 'hoi', tags: [] } })],
    }));
    const sel = '.circle-nearby__allow span, .circle-nearby__allow-off, .circle-nearby__card-title,'
      + ' .circle-nearby__card-visible, .circle-nearby__card-save, .circle-nearby__chat-title,'
      + ' .circle-nearby__chat-ephemeral, .circle-nearby__chat-empty, .circle-nearby__chat-send';
    for (const n of el.querySelectorAll(sel)) {
      const txt = n.textContent.trim();
      if (txt) expect(txt.startsWith('circle.'), `untranslated: "${txt}"`).toBe(true);
    }
  });
});

describe('circles advertised in the room (step H)', () => {
  const entry = (over = {}) => ({
    invite: { uri: 'stoop-invite://abc', circleId: 'c1', circleName: 'Buurt' },
    actions: ['join-published-circle'], note: 'join-is-a-join', ...over,
  });

  it('lists an advertised circle by name, with one action', () => {
    const el = render(model({ invites: [entry()] }));
    expect(el.querySelector('.circle-nearby__invite-name').textContent).toBe('Buurt');
    const actions = [...el.querySelectorAll('.circle-nearby__invite-action')].map((b) => b.dataset.action);
    expect(actions).toEqual(['join-published-circle']);
  });

  it('EVERY invite says the join is real — the carrier changed, the gate did not', () => {
    const el = render(model({ invites: [entry(), entry({ invite: { circleId: 'c2', circleName: 'B' } })] }));
    const notes = [...el.querySelectorAll('.circle-nearby__invite-note')];
    expect(notes).toHaveLength(2);
    expect(notes[0].textContent).toBe('circle.nearbyScreen.join_is_a_join');
  });

  it('falls back to the id when a circle advertises no name', () => {
    const el = render(model({ invites: [entry({ invite: { circleId: 'c9', circleName: '' } })] }));
    expect(el.querySelector('.circle-nearby__invite-name').textContent).toBe('c9');
  });

  it('clicking join reports the invite, so the host can run the SAME wizard as a QR', () => {
    const onInviteAction = vi.fn();
    const el = render(model({ invites: [entry()] }), { onInviteAction });
    el.querySelector('.circle-nearby__invite-action').click();
    expect(onInviteAction).toHaveBeenCalledWith(
      'join-published-circle', expect.objectContaining({ uri: 'stoop-invite://abc' }),
    );
  });

  it('an expired invite (no actions) renders no action bar', () => {
    const el = render(model({ invites: [entry({ actions: [] })] }));
    expect(el.querySelector('.circle-nearby__invite-actions')).toBeNull();
  });

  it('an unknown invite action is skipped rather than shown raw', () => {
    const el = render(model({ invites: [entry({ actions: ['save-for-later', 'join-published-circle'] })] }));
    const actions = [...el.querySelectorAll('.circle-nearby__invite-action')].map((b) => b.dataset.action);
    expect(actions).toEqual(['join-published-circle']);
  });

  it('an empty room says so', () => {
    const el = render(model({ invites: [] }));
    expect(el.querySelector('.circle-nearby__invites-empty').textContent)
      .toBe('circle.nearbyScreen.invites_empty');
  });

  it('no untranslated strings in the invite block', () => {
    const el = render(model({ invites: [entry()] }));
    for (const n of el.querySelectorAll('.circle-nearby__invites-title, .circle-nearby__invite-note, .circle-nearby__invite-action')) {
      const txt = n.textContent.trim();
      if (txt) expect(txt.startsWith('circle.'), `untranslated: "${txt}"`).toBe(true);
    }
  });
});

