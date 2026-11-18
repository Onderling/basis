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

  it('the state line is what you press, and it opens the gear menu (one menu, no second sheet behind the line)', () => {
    const el = render(model({ visibility: { publishing: false, degraded: false, unavailable: false } }));
    const line = el.querySelector('.circle-nearby__visibility button.circle-nearby__visibility-title');
    expect(line, 'the state line is a button').not.toBeNull();
    expect(line.textContent).toBe('circle.nearbyScreen.hidden_title');
    expect(el.querySelector('.circle-nearby__menu').hidden, 'closed until asked for').toBe(true);
    line.click();
    expect(el.querySelector('.circle-nearby__menu').hidden).toBe(false);
    expect(el.querySelector('[data-menu-view="main"]').hidden).toBe(false);
  });

  it('a DEGRADED state keeps its sentence in view instead of folding it away', () => {
    // The one state that is a warning rather than an explanation: being announced after asking to be
    // hidden must not need a click to be read.
    const el = render(model({ visibility: { publishing: true, degraded: true, unavailable: false } }));
    expect(el.querySelector('.circle-nearby__visibility summary')).toBeNull();
    expect(el.querySelector('.circle-nearby__visibility-body').textContent)
      .toBe('circle.nearbyScreen.still_visible_body');
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

  it('an empty room says so ONCE, and the own-profile footer still renders', () => {
    // The production shape: at zero peers `buildNearbyModel` swaps the header line itself for
    // `header_empty`. The renderer used to add a second line with the same key underneath, so the
    // screen said "Nobody nearby right now." twice — one fact, twice, which is the thing the Nearby
    // fold exists to stop.
    const el = render(model({ headerLabel: 'circle.nearbyScreen.header_empty' }));
    const times = el.textContent.split('circle.nearbyScreen.header_empty').length - 1;
    expect(times, 'the empty-room sentence belongs on screen exactly once').toBe(1);
    expect(el.querySelector('.circle-nearby__own-skills').textContent)
      .toBe('circle.nearbyScreen.own_profile_empty');
  });

  it('has no back link — Nearby is a tab of its own, not a page under Circles', () => {
    const el = render(model(), { onBack: vi.fn() });
    expect(el.querySelector('.circle-nearby__back')).toBe(null);
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
    expect(el.querySelector('.circle-nearby__asks'), 'no asks: the part is not painted').toBeNull();
    expect(el.textContent).not.toContain('asks_empty');
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
    expect(boxes.map((b) => b.dataset.allow).sort()).toEqual(['card', 'chat']);
    expect(boxes.every((b) => b.checked)).toBe(false);
  });

  it('an OFF allow says what OTHERS see, not what the setting is', () => {
    // "Show my card here: off" tells you the switch position. "Nobody here sees a card from you" tells you
    // the consequence, which is the thing you actually wanted to know.
    const el = render(model());
    expect(el.querySelector('.circle-nearby__allow-off--card').textContent)
      .toBe('circle.nearbyScreen.allow_card_off');
    expect(el.querySelector('.circle-nearby__allow-off--chat').textContent)
      .toBe('circle.nearbyScreen.menu_chat_off');
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
    invite: { uri: 'onderling-invite://abc', circleId: 'c1', circleName: 'Circle' },
    actions: ['join-published-circle'], note: 'join-is-a-join', ...over,
  });

  it('lists an advertised circle by name, with one action', () => {
    const el = render(model({ invites: [entry()] }));
    expect(el.querySelector('.circle-nearby__invite-name').textContent).toBe('Circle');
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
      'join-published-circle', expect.objectContaining({ uri: 'onderling-invite://abc' }),
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

  it('no circle offered: the part is not painted at all, no "nothing here" line', () => {
    const el = render(model({ invites: [] }));
    expect(el.querySelector('.circle-nearby__invites')).toBeNull();
    expect(el.textContent).not.toContain('invites_empty');
  });

  it('no untranslated strings in the invite block', () => {
    const el = render(model({ invites: [entry()] }));
    for (const n of el.querySelectorAll('.circle-nearby__invites-title, .circle-nearby__invite-note, .circle-nearby__invite-action')) {
      const txt = n.textContent.trim();
      if (txt) expect(txt.startsWith('circle.'), `untranslated: "${txt}"`).toBe(true);
    }
  });
});


describe('the card prefill', () => {
  it('fills the name field with what the shell hands back (the room self\'s release) — nothing is sent until the person sends it', async () => {
    const sent = [];
    const el = render(model({ allows: { card: true, chat: false } }), { onPrefillCard: async () => ({ label: 'Werk' }), onSubmitCard: (f) => sent.push(f) });
    const fill = el.querySelector('.circle-nearby__card-prefill');
    expect(fill, 'the button is offered').not.toBe(null);
    fill.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(el.querySelector('.circle-nearby__card-label').value).toBe('Werk');
    expect(sent, 'filling is not sending').toEqual([]);
  });
  it('an empty release leaves the field as it was', async () => {
    const el = render(model({ allows: { card: true, chat: false } }), { onPrefillCard: async () => ({}) });
    el.querySelector('.circle-nearby__card-label').value = 'mine';
    el.querySelector('.circle-nearby__card-prefill').click();
    await new Promise((r) => setTimeout(r, 0));
    expect(el.querySelector('.circle-nearby__card-label').value).toBe('mine');
  });
});

describe('the first-use question', () => {
  it('asks before anything else, offers every level, and hands the choice back', () => {
    const chosen = [];
    let later = 0;
    const el = render(model(), { firstUse: { onChoose: (v) => chosen.push(v), onLater: () => { later += 1; } } });
    const block = el.querySelector('.circle-nearby__first-use');
    expect(block, 'the question is shown').not.toBe(null);
    expect(el.querySelector('.circle-nearby__top').nextElementSibling, 'right under the title row').toBe(block);
    const opts = [...block.querySelectorAll('.circle-nearby__first-use-option')];
    expect(opts.map((b) => b.textContent)).toEqual(['circle.nearbyScreen.face_none', 'circle.reveal.preset.handle', 'circle.reveal.preset.profile', 'circle.reveal.preset.full']);
    opts[2].click();
    expect(chosen).toEqual(['profile']);
    block.querySelector('.circle-nearby__first-use-later').click();
    expect(later).toBe(1);
  });
  it('is absent when the shell does not ask', () => {
    expect(render(model()).querySelector('.circle-nearby__first-use')).toBe(null);
  });
});

describe('the two tabs (Conversation · Questions), painted from the shared list', () => {
  const panel = (el, tab) => el.querySelector(`.circle-nearby__panel--${tab}`);
  const sections = (el, tab) => [...panel(el, tab).children].map((n) => n.dataset.section);

  it('a full room: the chat in Conversation; the ask field, my asks, the room\'s asks, who is here, circles in Questions', () => {
    const el = render(model({
      allows: { card: false, chat: true }, chat: [{ id: 'm1', text: 'hoi' }],
      myAsks: [{ ask: { id: 'a0' }, heard: 1, answers: [] }],
      asks: [{ ask: { id: 'a1', text: 'fiets?' }, actions: [] }],
      rows: [row()],
      invites: [{ invite: { circleId: 'c1', circleName: 'C' }, actions: [] }],
    }));
    expect([...el.querySelectorAll('.circle-nearby__tab')].map((b) => b.textContent))
      .toEqual(['circle.nearbyScreen.tab_conversation', 'circle.nearbyScreen.tab_questions']);
    expect(sections(el, 'conversation')).toEqual(['nearby-chat']);
    expect(sections(el, 'questions')).toEqual(['nearby-ask-field', 'nearby-my-asks', 'nearby-asks', 'nearby-peers', 'nearby-invites']);
  });

  it('in the chat: opens on Conversation; clicking Questions shows that one, and a redraw keeps it', () => {
    const el = document.createElement('div');
    const m = model({ allows: { card: false, chat: true }, chat: [] });
    renderCircleNearby(el, { model: m, t });
    expect(panel(el, 'conversation').hidden).toBe(false);
    expect(panel(el, 'questions').hidden).toBe(true);
    el.querySelector('.circle-nearby__tab--questions').click();
    expect(panel(el, 'questions').hidden).toBe(false);
    expect(el.querySelector('.circle-nearby__tab--questions').getAttribute('aria-selected')).toBe('true');
    renderCircleNearby(el, { model: m, t });
    expect(panel(el, 'questions').hidden, 'the person\'s pick survives a redraw').toBe(false);
  });

  it('not in the chat: opens on Questions; Conversation says so in one line, with the way to join', () => {
    const onToggleAllow = vi.fn();
    const el = render(model({ chat: null }), { onToggleAllow });
    expect(panel(el, 'questions').hidden).toBe(false);
    expect(sections(el, 'conversation')).toEqual(['nearby-chat-off']);
    expect(el.querySelector('.circle-nearby__chat-off-line').textContent).toBe('circle.nearbyScreen.allow_chat_off');
    el.querySelector('.circle-nearby__chat-join').click();
    expect(onToggleAllow).toHaveBeenCalledWith('chat', true);
  });

  it('the gear menu sits above the tabs, closed: nothing about you stands on the page', () => {
    const el = render(model());
    const menu = el.querySelector('.circle-nearby__menu');
    expect(menu.compareDocumentPosition(el.querySelector('.circle-nearby__tabs')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(menu.hidden).toBe(true);
    expect(el.querySelector('.circle-nearby__mine')).toBeNull();
  });
});

describe('the Conversation stream: questions and offered circles as cards between the chat lines (nearbyStream)', () => {
  const tv = (k, v = {}) => (Object.keys(v).length ? `${k}(${Object.entries(v).map(([a, b]) => `${a}=${b}`).join(',')})` : k);
  const room = () => model({
    allows: { card: false, chat: true },
    chat: [{ id: 'm1', text: 'hoi', who: 'Ans', at: 100 }, { id: 'm2', text: 'ja', who: 'Jij', at: 300, mine: true }],
    asks: [{ ask: { id: 'a1', text: 'pomp?', expiresAt: Date.now() + 120_000 }, receivedAt: 200, who: 'Bob', resonant: true, reason: 'fietsen', actions: ['answer-ask', 'dismiss-ask'] }],
    invites: [{ invite: { circleId: 'c1', circleName: 'Tuin', receivedAt: 400 }, who: 'Dirk', actions: ['join-published-circle'] }],
  });
  const streamOf = (el) => [...el.querySelector('[data-section="nearby-chat"]').children]
    .filter((n) => n.matches('.circle-nearby__chat-line, .circle-nearby__stream-card'))
    .map((n) => n.dataset.streamKind ?? 'line');

  it('in arrival order, oldest first; each card boxed and headed with who, so it does not read as a chat line', () => {
    const el = document.createElement('div');
    renderCircleNearby(el, { model: room(), t: tv });
    expect(streamOf(el)).toEqual(['line', 'ask', 'line', 'invite']);
    const ask = el.querySelector('.circle-nearby__stream-card[data-stream-kind="ask"]');
    expect(ask.querySelector('.circle-nearby__stream-head').textContent).toBe('circle.nearbyScreen.stream_ask_from(name=Bob)');
    expect(ask.querySelector('.circle-nearby__ask-reason').textContent).toContain('fietsen');
    expect(ask.querySelector('.circle-nearby__ask-clock').textContent).toContain('ask_expires_in');
    const inv = el.querySelector('.circle-nearby__stream-card[data-stream-kind="invite"]');
    expect(inv.querySelector('.circle-nearby__stream-head').textContent).toBe('circle.nearbyScreen.stream_invite_from(name=Dirk)');
  });

  it('Answer / Dismiss / Join on a card go through the same handlers as the Questions tab', () => {
    const onAskAction = vi.fn(); const onInviteAction = vi.fn();
    const el = document.createElement('div');
    const m = room();
    renderCircleNearby(el, { model: m, t, onAskAction, onInviteAction });
    const card = el.querySelector('.circle-nearby__stream-card[data-stream-kind="ask"]');
    card.querySelector('[data-action="answer-ask"]').click();
    card.querySelector('[data-action="dismiss-ask"]').click();
    expect(onAskAction.mock.calls).toEqual([['answer-ask', m.asks[0].ask], ['dismiss-ask', m.asks[0].ask]]);
    el.querySelector('.circle-nearby__stream-card[data-stream-kind="invite"] [data-action="join-published-circle"]').click();
    expect(onInviteAction).toHaveBeenCalledWith('join-published-circle', m.invites[0].invite);
  });

  it('the question and the circle stay in the Questions tab too', () => {
    const el = render(room());
    expect(el.querySelector('[data-section="nearby-asks"] .circle-nearby__ask[data-ask-id="a1"]')).not.toBeNull();
    expect(el.querySelector('[data-section="nearby-invites"] .circle-nearby__invite[data-circle-id="c1"]')).not.toBeNull();
  });

  it('each tab counts what is new; the open tab is seen, opening the other one marks it seen', () => {
    const el = document.createElement('div');
    renderCircleNearby(el, { model: room(), t: tv });
    const label = (id) => el.querySelector(`.circle-nearby__tab--${id}`).textContent;
    // Conversation is open (in the chat): seen. Questions: the question and the circle are new.
    expect(label('conversation')).toBe('circle.nearbyScreen.tab_conversation');
    expect(label('questions')).toBe('circle.nearbyScreen.tab_with_new(label=circle.nearbyScreen.tab_questions,count=2)');
    el.querySelector('.circle-nearby__tab--questions').click();
    expect(label('questions')).toBe('circle.nearbyScreen.tab_questions');
    // a new chat line arrives while Questions is open: Conversation counts it
    const next = room();
    next.chat.push({ id: 'm3', text: 'nog iets', who: 'Ans', at: 500 });
    renderCircleNearby(el, { model: next, t: tv });
    expect(label('conversation')).toBe('circle.nearbyScreen.tab_with_new(label=circle.nearbyScreen.tab_conversation,count=1)');
    expect(label('questions')).toBe('circle.nearbyScreen.tab_questions');
  });
});

describe('hidden from the room: Conversation shows no stream, one line and the way to become visible', () => {
  const hiddenRoom = (over = {}) => model({
    allows: { card: false, chat: true },
    chat: [{ id: 'm1', text: 'hoi', who: 'Ans', at: 100 }],
    visibility: { publishing: false, levelChosen: true }, quiet: true, radioOff: false, ...over,
  });

  it('even stil: the hidden line, and its button leaves quiet (the controller\'s setQuiet)', () => {
    const onSetQuiet = vi.fn();
    const el = render(hiddenRoom(), { onSetQuiet });
    expect(el.querySelector('[data-section="nearby-chat"]')).toBeNull();
    const off = el.querySelector('[data-section="nearby-chat-off"]');
    expect(off.dataset.reason).toBe('hidden');
    expect(off.querySelector('.circle-nearby__chat-off-line').textContent).toBe('circle.nearbyScreen.chat_hidden_line');
    off.querySelector('.circle-nearby__chat-visible').click();
    expect(onSetQuiet).toHaveBeenCalledWith(false);
    expect(el.querySelector('.circle-nearby__chat-input')).toBeNull();
  });

  it('the radio off: the button turns it back on', () => {
    const onSetRadio = vi.fn();
    const el = render(hiddenRoom({ visibility: { radioOff: true }, radioOff: true, quiet: false }), { onSetRadio });
    el.querySelector('.circle-nearby__chat-visible').click();
    expect(onSetRadio).toHaveBeenCalledWith('on');
  });

  it('a host that cannot carry the act shows the line without a dead button', () => {
    const el = render(hiddenRoom());
    expect(el.querySelector('.circle-nearby__chat-off-line')).not.toBeNull();
    expect(el.querySelector('.circle-nearby__chat-visible')).toBeNull();
  });
});

describe('hidden: Questions shows no ask composer (nearbyAskOff)', () => {
  const hiddenRoom = (over = {}) => model({ visibility: { publishing: false, levelChosen: true }, quiet: true, radioOff: false, ...over });
  it('the hidden line and "become visible" in place of the composer; the button leaves quiet', () => {
    const onSetQuiet = vi.fn();
    const el = render(hiddenRoom(), { onSetQuiet });
    expect(el.querySelector('[data-section="nearby-ask-field"]')).toBeNull();
    expect(el.querySelector('.circle-nearby__ask-compose')).toBeNull();
    const off = el.querySelector('[data-section="nearby-ask-off"]');
    expect(off.querySelector('.circle-nearby__ask-off-line').textContent).toBe('circle.nearbyScreen.ask_hidden_line');
    off.querySelector('.circle-nearby__ask-visible').click();
    expect(onSetQuiet).toHaveBeenCalledWith(false);
  });
  it('a refusal\'s notice stays in view there', () => {
    const el = render(hiddenRoom(), { notice: { key: 'card_hidden' } });
    expect(el.querySelector('[data-section="nearby-ask-off"] .circle-nearby__notice').dataset.notice).toBe('card_hidden');
  });
  it('no host act: the line without a dead button', () => {
    const el = render(hiddenRoom());
    expect(el.querySelector('.circle-nearby__ask-visible')).toBeNull();
  });
});

describe('the gear menu (nearbyMenu): how you are here, what you show, the chat, the introduction', () => {
  const open = (el) => { el.querySelector('.circle-nearby__gear').click(); return el.querySelector('.circle-nearby__menu'); };
  it('the gear opens it and the close button shuts it; the gear has a name, not a glyph for text', () => {
    const el = render(model());
    const gear = el.querySelector('.circle-nearby__gear');
    expect(gear.getAttribute('aria-label')).toBe('circle.nearbyScreen.menu_title');
    expect(gear.textContent).toBe('');
    const menu = open(el);
    expect(menu.hidden).toBe(false);
    expect(menu.querySelector('.circle-nearby__menu-title').textContent).toBe('circle.nearbyScreen.menu_title');
    menu.querySelector('.circle-nearby__menu-close').click();
    expect(menu.hidden).toBe(true);
  });
  it('a host without quiet and radio acts (the web) offers only Zichtbaar; a phone host offers all three, the one that holds checked', () => {
    const web = open(render(model({ visibility: { publishing: true, levelChosen: true } })));
    expect([...web.querySelectorAll('input[name="nearby-here"]')].map((r) => r.value)).toEqual(['visible']);
    const onHereChoose = vi.fn();
    const phone = open(render(model({ visibility: { publishing: false, levelChosen: true, quiet: true } }), { onSetQuiet: vi.fn(), onSetRadio: vi.fn(), onHereChoose }));
    const radios = [...phone.querySelectorAll('input[name="nearby-here"]')];
    expect(radios.map((r) => r.value)).toEqual(['visible', 'quiet', 'off']);
    expect(radios.find((r) => r.checked)?.value).toBe('quiet');
    expect(phone.querySelector('.circle-nearby__here--off .circle-nearby__here-body').textContent).toBe('circle.nearbyScreen.here_off_body');
    radios[0].checked = true;
    radios[0].dispatchEvent(new Event('change', { bubbles: true }));
    expect(onHereChoose).toHaveBeenCalledWith('visible');
  });
  it('"Change" opens who you appear as and the finer levels; the card row opens the card editor with its own switch on top', () => {
    const el = render(model({ allows: { card: false, chat: false } }), {
      roomSelf: { view: { self: { id: 'me', name: 'Anna' }, choices: [] } }, onLevelChange: vi.fn(),
    });
    const menu = open(el);
    expect(menu.querySelector('.circle-nearby__menu-row--self span').textContent).toBe('circle.nearbyScreen.menu_appear_as');
    menu.querySelector('.circle-nearby__menu-change').click();
    const self = menu.querySelector('[data-menu-view="self"]');
    expect(self.hidden).toBe(false);
    expect(self.querySelectorAll('.circle-nearby__face-option')).toHaveLength(4);
    self.querySelector('.circle-nearby__menu-back').click();
    menu.querySelector('.circle-nearby__menu-row--card').click();
    const card = menu.querySelector('[data-menu-view="card"]');
    expect(card.hidden).toBe(false);
    expect(card.querySelector('.circle-nearby__allows input').dataset.allow, 'the card switch, first in the editor').toBe('card');
    expect(menu.querySelector('[data-menu-view="main"] input[data-allow="card"]'), 'not a menu row').toBeNull();
  });
  it('the chat switch is in the menu with what being out means; the introduction again goes to the host', () => {
    const onIntroAgain = vi.fn();
    const menu = open(render(model({ allows: { card: false, chat: false } }), { onIntroAgain }));
    const main = menu.querySelector('[data-menu-view="main"]');
    expect(main.querySelector('input[data-allow="chat"]').checked).toBe(false);
    expect(main.querySelector('.circle-nearby__allow-off--chat').textContent).toBe('circle.nearbyScreen.menu_chat_off');
    main.querySelector('.circle-nearby__menu-intro').click();
    expect(onIntroAgain).toHaveBeenCalled();
    expect(menu.hidden).toBe(true);
  });
});
