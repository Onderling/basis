// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderCircleView } from '../../web/v2/circleView.js';
import { createInputHistory } from '../../src/v2/commandSuggest.js';
import { circleChatMessageEvent } from '@onderling/kring-host/circleBroadcast';

const t = (key, params) =>
  params && params.count != null ? `${key}:${params.count}` : key;

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

const circle = { id: 'g1', name: 'Selwerd', memberCount: 87 };

const yest = Date.now() - 24 * 60 * 60 * 1000;
const now  = Date.now();

// `senderLabel` is what `chatRows` stamps through the reveal ladder; the renderer paints it and
// ignores any payload `senderDisplay` (which could be a wire-claimed name). Rows here carry the
// stamp directly, as a stamped row would.
const rows = [
  // newest-first (matches buildCircleStream output)
  {
    id: 'r3', ts: now,        app: 'household', type: 'chat-message',
    actor: 'Pieter', circleId: 'g1', senderLabel: 'Pieter',
    event: { id: 'r3', type: 'chat-message', payload: { text: 'Bedankt!', senderDisplay: 'Pieter' } },
  },
  {
    id: 'r2', ts: now - 60_000, app: 'stoop', type: 'circle-post',
    actor: 'Pieter', circleId: 'g1', senderLabel: 'Pieter',
    event: { id: 'r2', type: 'circle-post', payload: { kind: 'offer', text: 'Boekje te geef.', authorName: 'Pieter' } },
  },
  {
    id: 'r1', ts: yest, app: 'stoop', type: 'circle-post',
    actor: 'Anne', circleId: 'g1', senderLabel: 'Anne',
    event: { id: 'r1', type: 'circle-post', payload: { kind: 'ask', text: 'Heeft iemand een ladder t/m vrijdag?', authorName: 'Anne' } },
  },
];

describe('renderCircleView · SP-13.2 chat-style circle view', () => {
  it('renders header (back + title + members meta)', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t });
    expect(el.querySelector('.circle-view__back').textContent).toBe('circle.back');
    expect(el.querySelector('.circle-view__title').textContent).toBe('Selwerd');
    expect(el.querySelector('.circle-view__meta').textContent).toBe('circle.members:87');
  });

  it('renders message bubbles chronologically (oldest at top)', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t });
    const bubbles = el.querySelectorAll('.circle-view__bubble');
    expect([...bubbles].map((b) => b.dataset.rowId)).toEqual(['r1', 'r2', 'r3']);
  });

  it('groups bubbles under dated day-dividers', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t });
    const days = el.querySelectorAll('.circle-view__day');
    expect(days.length).toBe(2);
    // First divider = yesterday's date (precedes r1).
    expect(days[0].textContent).toBe('circle.circle.day_yesterday');
    // Second divider = today's date (precedes r2 + r3).
    expect(days[1].textContent).toBe('circle.circle.day_today');
  });

  it('shows a KIND pill on bubbles whose payload carries a kind ≠ message', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t });
    const bubbles = el.querySelectorAll('.circle-view__bubble');
    // r1 ask, r2 offer, r3 chat-message (no pill).
    expect(bubbles[0].querySelector('.circle-view__bubble-kind').textContent).toBe('ASK');
    expect(bubbles[1].querySelector('.circle-view__bubble-kind').textContent).toBe('OFFER');
    expect(bubbles[2].querySelector('.circle-view__bubble-kind')).toBeNull();
  });

  it('renders sender label + body text + substrate action chips', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t });
    const bubbles = el.querySelectorAll('.circle-view__bubble');
    // r1 = ask → [help, ignore] via streamActions.
    expect(bubbles[0].querySelector('.circle-view__bubble-sender').textContent).toBe('Anne');
    expect(bubbles[0].querySelector('.circle-view__bubble-text').textContent)
      .toBe('Heeft iemand een ladder t/m vrijdag?');
    const acts = bubbles[0].querySelectorAll('.circle-view__bubble-action');
    expect([...acts].map((b) => b.dataset.action)).toEqual(['help', 'ignore']);
  });

  it('renders the inline composer when onSend is wired', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t });
    expect(el.querySelector('.circle-view__composer')).toBeNull();

    const el2 = mount();
    const onSend = vi.fn();
    renderCircleView(el2, { circle, rows, t, onSend });
    const form  = el2.querySelector('.circle-view__composer');
    const input = el2.querySelector('.circle-view__composer-input');
    expect(form).not.toBeNull();
    expect(input.placeholder).toBe('circle.circle.composer_placeholder');
  });

  it('composer submit fires onSend(text) and clears the input', () => {
    const el = mount();
    const onSend = vi.fn();
    renderCircleView(el, { circle, rows, t, onSend });
    const input = el.querySelector('.circle-view__composer-input');
    const form  = el.querySelector('.circle-view__composer');
    input.value = '  Hoi circle!  ';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toBe('Hoi circle!');
    expect(input.value).toBe('');
  });

  it('composer ignores empty / whitespace-only submits', () => {
    const el = mount();
    const onSend = vi.fn();
    renderCircleView(el, { circle, rows, t, onSend });
    const input = el.querySelector('.circle-view__composer-input');
    const form  = el.querySelector('.circle-view__composer');
    input.value = '   ';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('composer honors a circle-specific placeholder when the host passes one', () => {
    const el = mount();
    renderCircleView(el, {
      circle, rows, t, onSend: () => {},
      composerPlaceholder: 'Schrijf naar de circle…',
    });
    expect(el.querySelector('.circle-view__composer-input').placeholder)
      .toBe('Schrijf naar de circle…');
  });

  it('empty state shows when rows = []', () => {
    const el = mount();
    renderCircleView(el, { circle, rows: [], t });
    expect(el.querySelector('.circle-view__empty').textContent).toBe('circle.circle.empty');
    expect(el.querySelectorAll('.circle-view__bubble')).toHaveLength(0);
  });

  it('overflow menu hides until a `more` action is provided + toggles on click', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t });
    expect(el.querySelector('.circle-view__more')).toBeNull();

    const el2 = mount();
    const onSettings = vi.fn();
    renderCircleView(el2, { circle, rows, t, more: { settings: onSettings } });
    const trigger = el2.querySelector('.circle-view__more');
    expect(trigger).not.toBeNull();
    const menu = el2.querySelector('.circle-view__more-menu');
    expect(menu.classList.contains('is-open')).toBe(false);
    trigger.click();
    expect(menu.classList.contains('is-open')).toBe(true);
    menu.querySelector('[data-action=settings]').click();
    expect(onSettings).toHaveBeenCalledTimes(1);
    expect(menu.classList.contains('is-open')).toBe(false);
  });

  it('fires onAction with action + row on a bubble action button click', () => {
    const el = mount();
    const onAction = vi.fn();
    renderCircleView(el, { circle, rows, t, onAction });
    el.querySelector('.circle-view__bubble .circle-view__bubble-action[data-action=help]').click();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0].action).toBe('help');
    expect(onAction.mock.calls[0][1].id).toBe('r1');
  });

  // ── Mandate ("entrust") — owner-only action + legibility on task rows ────────
  describe('entrust (mandate) action', () => {
    const choreRow = {
      id: 'chore-1', ts: now, circleId: circle.id, type: 'circle-post', actor: 'Anne',
      event: { id: 'chore-1', type: 'circle-post', payload: { kind: 'chore', text: 'Vuilnis buiten zetten', ref: 'task-77', addedBy: 'https://me.example/#me' } },
    };

    it('is hidden by default (no viewer signals threaded)', () => {
      const el = mount();
      renderCircleView(el, { circle, rows: [choreRow], t });
      expect(el.querySelector('.circle-view__bubble-action[data-action=mandate]')).toBeNull();
    });

    it('appears for the owner (viewer WebID matches the row creator)', () => {
      const el = mount();
      renderCircleView(el, { circle, rows: [choreRow], t, viewerWebid: 'https://me.example/#me' });
      const btn = el.querySelector('.circle-view__bubble-action[data-action=mandate]');
      expect(btn).not.toBeNull();
      expect(btn.classList.contains('circle-view__bubble-action--mandate')).toBe(true);
    });

    it('stays hidden for a non-owner viewer', () => {
      const el = mount();
      renderCircleView(el, { circle, rows: [choreRow], t, viewerWebid: 'https://someone-else.example/#me' });
      expect(el.querySelector('.circle-view__bubble-action[data-action=mandate]')).toBeNull();
    });

    it('appears for a circle admin', () => {
      const el = mount();
      renderCircleView(el, { circle, rows: [choreRow], t, viewerIsAdmin: true });
      expect(el.querySelector('.circle-view__bubble-action[data-action=mandate]')).not.toBeNull();
    });

    it('onAction receives the mandate action carrying the taskId', () => {
      const el = mount();
      const onAction = vi.fn();
      renderCircleView(el, { circle, rows: [choreRow], t, onAction, viewerIsAdmin: true });
      el.querySelector('.circle-view__bubble-action[data-action=mandate]').click();
      expect(onAction.mock.calls[0][0].action).toBe('mandate');
      expect(onAction.mock.calls[0][0].payload.taskId).toBe('task-77');
    });

    it('renders the legibility list when a task row carries source.taskGrants', () => {
      const el = mount();
      const withGrants = {
        ...choreRow,
        event: { ...choreRow.event, payload: { ...choreRow.event.payload, taskGrants: [{ member: 'https://alice.example/#me', skill: 'off-baking' }] } },
      };
      renderCircleView(el, { circle, rows: [withGrants], t });
      expect(el.querySelectorAll('.cc-mandate-legibility__item')).toHaveLength(1);
    });
  });

  /* ─── — per-circle bottom tabs ─── */

  const circleTabs = [
    { id: 'conversation',  label: 'CONVERSATION' },
    { id: 'noticeboard', label: 'NOTICEBOARD' },
    { id: 'members',    label: 'MEMBERS' },
  ];

  it('tab bar hides when fewer than 2 tabs are supplied', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t, tabs: [{ id: 'conversation', label: 'CONVERSATION' }] });
    expect(el.querySelector('.circle-view__tabs')).toBeNull();
  });

  it('renders one tab button per entry with the active one marked', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t, tabs: circleTabs, activeTab: 'noticeboard' });
    const btns = el.querySelectorAll('.circle-view__tab');
    expect([...btns].map((b) => b.dataset.tab)).toEqual(['conversation', 'noticeboard', 'members']);
    expect(el.querySelector('.circle-view__tab.is-active').dataset.tab).toBe('noticeboard');
  });

  it('non-CONVERSATION tabs render the placeholder body (V0 of SP-13.3)', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t, tabs: circleTabs, activeTab: 'noticeboard' });
    expect(el.querySelector('.circle-view__placeholder')).not.toBeNull();
    // Bubble list is suppressed for non-chat tabs.
    expect(el.querySelectorAll('.circle-view__bubble')).toHaveLength(0);
  });

  it('CONVERSATION tab still renders the bubble list', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t, tabs: circleTabs, activeTab: 'conversation' });
    expect(el.querySelector('.circle-view__placeholder')).toBeNull();
    expect(el.querySelectorAll('.circle-view__bubble')).toHaveLength(3);
  });

  it('clicking a non-active tab fires onTab(id); clicking the active one is a no-op', () => {
    const el = mount();
    const onTab = vi.fn();
    renderCircleView(el, { circle, rows, t, tabs: circleTabs, activeTab: 'conversation', onTab });
    el.querySelector('.circle-view__tab[data-tab=members]').click();
    expect(onTab).toHaveBeenCalledTimes(1);
    expect(onTab.mock.calls[0][0]).toBe('members');
    el.querySelector('.circle-view__tab[data-tab=conversation]').click();
    expect(onTab).toHaveBeenCalledTimes(1); // unchanged — re-tap on active = no-op
  });

  it('defaults activeTab to the first tab id when caller omits it', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t, tabs: circleTabs });
    expect(el.querySelector('.circle-view__tab.is-active').dataset.tab).toBe('conversation');
  });

  it('composer stays visible regardless of active tab (v2 §1 boards)', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t, tabs: circleTabs, activeTab: 'members', onSend: () => {} });
    expect(el.querySelector('.circle-view__composer')).not.toBeNull();
  });

  /* ─── — Chat ↔ Screen header pill (v2 §4 "De mode switch") ─── */

  it('view-toggle pill hides unless onViewMode is wired', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t });
    expect(el.querySelector('.circle-view__view-toggle')).toBeNull();
  });

  it('renders both Chat and Screen buttons with the active one marked', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t, viewMode: 'chat', onViewMode: () => {} });
    const btns = el.querySelectorAll('.circle-view__view-toggle-btn');
    expect([...btns].map((b) => b.dataset.viewMode)).toEqual(['chat', 'screen']);
    expect(el.querySelector('.circle-view__view-toggle-btn.is-active').dataset.viewMode).toBe('chat');
    expect(btns[0].getAttribute('aria-pressed')).toBe('true');
    expect(btns[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking the inactive view-toggle fires onViewMode; clicking the active one is a no-op', () => {
    const el = mount();
    const onViewMode = vi.fn();
    renderCircleView(el, { circle, rows, t, viewMode: 'chat', onViewMode });
    el.querySelector('.circle-view__view-toggle-btn[data-view-mode=screen]').click();
    expect(onViewMode).toHaveBeenCalledTimes(1);
    expect(onViewMode.mock.calls[0][0]).toBe('screen');
    el.querySelector('.circle-view__view-toggle-btn[data-view-mode=chat]').click();
    expect(onViewMode).toHaveBeenCalledTimes(1); // unchanged — re-tap on active = no-op
  });

  it('screen-mode renders the screen body (α.1c) and suppresses bubbles', () => {
    // No screenBlocks wired → renderCircleScreen falls through to its
    // own empty-state.  The body must contain a circle-screen subtree
    // (not chat bubbles).
    const el = mount();
    renderCircleView(el, { circle, rows, t, viewMode: 'screen', onViewMode: () => {} });
    expect(el.querySelector('.circle-screen')).not.toBeNull();
    expect(el.querySelector('.circle-screen__empty').textContent).toBe('circle.screen.empty');
    expect(el.querySelectorAll('.circle-view__bubble')).toHaveLength(0);
  });

  it('screen-mode with screenBlocks renders each materialized block', () => {
    const el = mount();
    const blocks = [
      { blockId: 'b1', type: 'announcement', status: 'ok', content: { text: 'Hi!' } },
      { blockId: 'b2', type: 'text',         status: 'ok', content: { text: 'meer hier' } },
    ];
    renderCircleView(el, {
      circle, rows, t,
      viewMode: 'screen', onViewMode: () => {},
      screenBlocks: blocks,
    });
    expect(el.querySelectorAll('.circle-screen__block')).toHaveLength(2);
    expect(el.querySelector('.circle-screen__block--announcement')).not.toBeNull();
    expect(el.querySelector('.circle-screen__block--text')).not.toBeNull();
  });

  it('screen-mode suppresses the composer even when onSend is wired', () => {
    const el = mount();
    renderCircleView(el, {
      circle, rows, t, viewMode: 'screen', onViewMode: () => {}, onSend: () => {},
    });
    expect(el.querySelector('.circle-view__composer')).toBeNull();
  });

  it('screen-mode suppresses the bottom tab bar even when ≥ 2 tabs are wired', () => {
    const el = mount();
    renderCircleView(el, {
      circle, rows, t, viewMode: 'screen', onViewMode: () => {}, tabs: circleTabs,
    });
    expect(el.querySelector('.circle-view__tabs')).toBeNull();
  });

  /* ─── δ.2 — per-message delivery state ─── */

  // Local-actor rows mimic what showCircle's onSend appends: actor === LOCAL_ACTOR
  // and type === 'chat-message'.  Circle-post mirrors are NOT locally-sent so
  // they never get a delivery icon, even when the actor coincidentally matches.
  const LOCAL = 'me';
  const localRow = {
    id: 'mine-1', ts: now + 5_000, app: 'circle', type: 'chat-message',
    actor: LOCAL, circleId: 'g1',
    event: { id: 'mine-1', type: 'chat-message', payload: { text: 'Hallo!', kind: 'chat-message' } },
  };

  it('locally-sent bubble shows a clock icon when delivery state is pending', () => {
    const el = mount();
    renderCircleView(el, {
      circle, rows: [localRow], t,
      deliveryStateFor: (id) => (id === 'mine-1' ? 'pending' : null),
      localActor: LOCAL,
    });
    const bubble = el.querySelector('[data-row-id="mine-1"]');
    const icon = bubble.querySelector('.circle-view__bubble-delivery--pending');
    expect(icon).not.toBeNull();
    expect(icon.getAttribute('aria-label')).toBe('circle.chat.delivery.pending');
  });

  it('clock icon disappears once delivery state flips to sent (happy path = no icon)', () => {
    const el = mount();
    renderCircleView(el, {
      circle, rows: [localRow], t,
      deliveryStateFor: () => 'sent',
      localActor: LOCAL,
    });
    const bubble = el.querySelector('[data-row-id="mine-1"]');
    expect(bubble.querySelector('.circle-view__bubble-delivery')).toBeNull();
  });

  it('failed state renders a warning button + tap fires onRetryDelivery(msgId)', () => {
    const el = mount();
    const onRetryDelivery = vi.fn();
    renderCircleView(el, {
      circle, rows: [localRow], t,
      deliveryStateFor: () => 'failed',
      localActor: LOCAL,
      onRetryDelivery,
    });
    const btn = el.querySelector('.circle-view__bubble-delivery--failed');
    expect(btn).not.toBeNull();
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('aria-label')).toBe('circle.chat.delivery.failed');
    btn.click();
    expect(onRetryDelivery).toHaveBeenCalledTimes(1);
    expect(onRetryDelivery).toHaveBeenCalledWith('mine-1');
  });

  it('peer messages (actor ≠ local) never get a delivery icon, even with state set', () => {
    const el = mount();
    renderCircleView(el, {
      circle, rows, t,                              // rows[0] = Anne (not LOCAL)
      deliveryStateFor: () => 'pending',
      localActor: LOCAL,
    });
    expect(el.querySelector('.circle-view__bubble-delivery')).toBeNull();
  });

  it('non-chat-message local rows (e.g. circle-post mirror) get no delivery icon', () => {
    const el = mount();
    const localPost = {
      id: 'mine-circle', ts: now + 1_000, app: 'stoop', type: 'circle-post',
      actor: LOCAL, circleId: 'g1',
      event: { id: 'mine-circle', type: 'circle-post', payload: { kind: 'offer', text: 'Hi' } },
    };
    renderCircleView(el, {
      circle, rows: [localPost], t,
      deliveryStateFor: () => 'pending',
      localActor: LOCAL,
    });
    expect(el.querySelector('.circle-view__bubble-delivery')).toBeNull();
  });

  it('no delivery icon renders when the host omits the delivery-state plumbing', () => {
    const el = mount();
    renderCircleView(el, { circle, rows: [localRow], t });
    expect(el.querySelector('.circle-view__bubble-delivery')).toBeNull();
  });
});

describe('renderCircleView · bulletin restyle (bot card · transparency · consent)', () => {
  const botRow = (payload) => ({
    id: 'b1', ts: now, app: 'circle', type: 'chat-message', actor: 'bot', circleId: 'g1',
    event: { id: 'b1', type: 'chat-message', actor: 'bot', payload: { text: 'Klaar.', ...payload } },
  });

  it('CONVERSATION renders the chat card wrapping the log, but NO assistant-header strip on a group circle (no botLabel)', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t });   // no botLabel → group / non-bot → gate closed
    const card = el.querySelector('.circle-view__chat-card');
    expect(card).not.toBeNull();
    // the head strip is gated OFF without a 1:1-bot botLabel
    expect(card.querySelector('.circle-view__bot-head')).toBeNull();
    expect(card.querySelector('.circle-view__bot-dot')).toBeNull();
    expect(card.querySelector('.circle-view__bot-name')).toBeNull();
    // the message log still lives inside the card
    expect(card.querySelector('.circle-view__list')).not.toBeNull();
  });

  it('shows the assistant-header strip (green dot + name) ONLY with a 1:1-bot botLabel', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t, botLabel: 'de uitleg-bot' });
    const card = el.querySelector('.circle-view__chat-card');
    expect(card.querySelector('.circle-view__bot-head')).not.toBeNull();
    expect(card.querySelector('.circle-view__bot-dot')).not.toBeNull();
    expect(card.querySelector('.circle-view__bot-name').textContent).toBe('de uitleg-bot');
  });

  it('screen-mode renders no bot card (not the assistant conversation)', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t, viewMode: 'screen', onViewMode: () => {} });
    expect(el.querySelector('.circle-view__chat-card')).toBeNull();
  });

  it('transparency badge stays dormant when a bot message carries no provenance', () => {
    const el = mount();
    renderCircleView(el, { circle, rows: [botRow({})], t });
    expect(el.querySelector('.circle-view__bubble-provenance')).toBeNull();
  });

  it('transparency badge renders a verbatim string provenance under a bot message', () => {
    const el = mount();
    renderCircleView(el, { circle, rows: [botRow({ provenance: '· direct beantwoord' })], t });
    expect(el.querySelector('.circle-view__bubble-provenance').textContent).toBe('· direct beantwoord');
  });

  it('transparency badge localizes an object provenance ({ llmUsed })', () => {
    const el = mount();
    renderCircleView(el, { circle, rows: [botRow({ provenance: { llmUsed: false } })], t });
    expect(el.querySelector('.circle-view__bubble-provenance').textContent).toBe('circle.circle.provenance_direct');
    const el2 = mount();
    renderCircleView(el2, { circle, rows: [botRow({ provenance: { llmUsed: true } })], t });
    expect(el2.querySelector('.circle-view__bubble-provenance').textContent).toBe('circle.circle.provenance_llm');
  });

  it('a consent bubble gets the --consent card variant + primary/secondary button classes', () => {
    const el = mount();
    const consentRow = botRow({
      consent: true,
      buttons: [
        { action: 'llm:yes', label: 'ja, doorsturen', variant: 'primary' },
        { action: 'llm:no', label: 'nee, ik kies zelf', variant: 'secondary' },
      ],
    });
    renderCircleView(el, { circle, rows: [consentRow], t, onEmbedButton: vi.fn() });
    const bubble = el.querySelector('.circle-view__bubble--consent');
    expect(bubble).not.toBeNull();
    expect(bubble.querySelector('.circle-view__consent-btn--primary').textContent).toBe('ja, doorsturen');
    expect(bubble.querySelector('.circle-view__consent-btn--secondary').textContent).toBe('nee, ik kies zelf');
  });
});

describe('renderCircleView · composer parity (slash-suggest + permission gate)', () => {
  const catalog = { opsById: new Map([
    ['addTask',      { op: { id: 'addTask',      surfaces: { slash: { command: '/addtask' },       chat: { hint: 'add a task' } } } }],
    ['completeTask', { op: { id: 'completeTask', surfaces: { slash: { command: '/complete-task' }, chat: { hint: 'finish a task' } } } }],
  ]) };

  it('permission gate: canPost=false renders a read-only note in place of the composer', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t, onSend: () => {}, canPost: false });
    expect(el.querySelector('.circle-view__composer')).toBeNull();
    const note = el.querySelector('.circle-view__composer-disabled');
    expect(note).not.toBeNull();
    expect(note.textContent).toBe('circle.circle.chat_disabled');
  });

  it('permission gate: canPost (default) renders the composer form, no note', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t, onSend: () => {} });
    expect(el.querySelector('.circle-view__composer')).not.toBeNull();
    expect(el.querySelector('.circle-view__composer-disabled')).toBeNull();
  });

  it('slash-suggest: typing "/" opens the dropdown; a space (into args) closes it', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t, onSend: () => {}, catalog });
    const input = el.querySelector('.circle-view__composer-input');
    const suggest = el.querySelector('.circle-view__suggest');
    input.value = '/';
    input.dispatchEvent(new Event('input'));
    expect(suggest.hidden).toBe(false);
    expect(el.querySelectorAll('.circle-view__suggest-item').length).toBe(2);
    input.value = '/addtask milk';
    input.dispatchEvent(new Event('input'));
    expect(suggest.hidden).toBe(true);
  });

  it('slash-suggest: a prefix filters the list', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t, onSend: () => {}, catalog });
    const input = el.querySelector('.circle-view__composer-input');
    input.value = '/comp';
    input.dispatchEvent(new Event('input'));
    expect([...el.querySelectorAll('.circle-view__suggest-cmd')].map((n) => n.textContent)).toEqual(['/complete-task']);
  });

  it('no catalog → no suggest dropdown wiring (composer still works)', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t, onSend: () => {} });
    const input = el.querySelector('.circle-view__composer-input');
    input.value = '/';
    input.dispatchEvent(new Event('input'));
    expect(el.querySelector('.circle-view__suggest').hidden).toBe(true);
  });

  it('history: submit records the message into the injected history (ArrowUp would recall it)', () => {
    const el = mount();
    const history = createInputHistory();
    const onSend = vi.fn();
    renderCircleView(el, { circle, rows, t, onSend, catalog, history });
    const input = el.querySelector('.circle-view__composer-input');
    input.value = 'hello circle';
    el.querySelector('.circle-view__composer').dispatchEvent(new Event('submit'));
    expect(onSend).toHaveBeenCalledWith('hello circle');
    expect(history.prev()).toBe('hello circle');
  });
});

describe('renderCircleView · multi-field inline form (mobile MultiFieldFormBubble parity)', () => {
  const pendingForm = {
    kind: 'multi',
    opId: 'respondToItem',
    appOrigin: 'stoop',
    threadId: null,
    replyShape: 'text',
    prefilledArgs: { itemId: 'i-7' },
    fields: [
      { name: 'body', kind: 'string', label: 'Body' },
      { name: 'when', kind: 'string', label: 'When' },
    ],
    title: 'Complete /respondToItem',
  };

  it('renders a titled form with one labelled input per missing field', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t, onSend: vi.fn(), pendingForm, onFormSubmit: vi.fn() });
    const form = el.querySelector('.circle-view__form');
    expect(form).toBeTruthy();
    expect(form.querySelector('.circle-view__form-title').textContent).toBe('Complete /respondToItem');
    const inputs = form.querySelectorAll('.circle-view__form-input');
    expect(inputs).toHaveLength(2);
    expect([...form.querySelectorAll('.circle-view__form-label')].map((l) => l.textContent)).toEqual(['Body', 'When']);
    expect(inputs[0].dataset.field).toBe('body');
    expect(inputs[1].dataset.field).toBe('when');
  });

  it('keeps submit disabled until every field is filled', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t, onSend: vi.fn(), pendingForm, onFormSubmit: vi.fn() });
    const submit = el.querySelector('.circle-view__form-submit');
    const [bodyInput, whenInput] = el.querySelectorAll('.circle-view__form-input');
    expect(submit.disabled).toBe(true);
    bodyInput.value = 'I can help'; bodyInput.dispatchEvent(new Event('input'));
    expect(submit.disabled).toBe(true);          // still one empty
    whenInput.value = 'Friday';     whenInput.dispatchEvent(new Event('input'));
    expect(submit.disabled).toBe(false);         // all filled
  });

  it('submits the collected values to onFormSubmit', () => {
    const el = mount();
    const onFormSubmit = vi.fn();
    renderCircleView(el, { circle, rows, t, onSend: vi.fn(), pendingForm, onFormSubmit });
    const [bodyInput, whenInput] = el.querySelectorAll('.circle-view__form-input');
    bodyInput.value = 'I can help'; bodyInput.dispatchEvent(new Event('input'));
    whenInput.value = 'Friday';     whenInput.dispatchEvent(new Event('input'));
    el.querySelector('.circle-view__form').dispatchEvent(new Event('submit'));
    expect(onFormSubmit).toHaveBeenCalledWith({ body: 'I can help', when: 'Friday' });
  });

  it('does not submit while a field is still empty (gated)', () => {
    const el = mount();
    const onFormSubmit = vi.fn();
    renderCircleView(el, { circle, rows, t, onSend: vi.fn(), pendingForm, onFormSubmit });
    const [bodyInput] = el.querySelectorAll('.circle-view__form-input');
    bodyInput.value = 'I can help'; bodyInput.dispatchEvent(new Event('input'));
    el.querySelector('.circle-view__form').dispatchEvent(new Event('submit'));
    expect(onFormSubmit).not.toHaveBeenCalled();
  });

  it('renders no form when pendingForm is null', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t, onSend: vi.fn() });
    expect(el.querySelector('.circle-view__form')).toBeNull();
  });

  it('suppresses the form in screen view-mode (not a chat surface)', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t, onSend: vi.fn(), pendingForm, onFormSubmit: vi.fn(), viewMode: 'screen' });
    expect(el.querySelector('.circle-view__form')).toBeNull();
  });
});

describe('renderCircleView · noticeboard tab → noticeboard (S1 #1)', () => {
  const tabs = [
    { id: 'conversation', feature: 'chat', labelKey: 'circle.tabs.conversation' },
    { id: 'noticeboard', feature: 'noticeboard', labelKey: 'circle.tabs.noticeboard' },
  ];

  it('renders the noticeboard (not the tab-coming placeholder) when noticeboard is active', () => {
    const onPost = vi.fn();
    const el = mount();
    renderCircleView(el, {
      circle, rows, t, onSend: vi.fn(),
      tabs, activeTab: 'noticeboard',
      noticeboard: { posts: [{ id: 'p1', type: 'ask', text: 'boormachine?', mine: false }], intent: 'ask', onPost },
    });
    // noticeboard body present, placeholder absent
    expect(el.querySelector('.cc-noticeboard')).not.toBeNull();
    expect(el.querySelector('.circle-view__placeholder')).toBeNull();
    expect(el.querySelector('.cc-noticeboard__post-row')).not.toBeNull();
    // the chat composer is suppressed (the noticeboard owns its own)
    expect(el.querySelector('.circle-view__composer')).toBeNull();
  });

  it('falls back to the tab-coming placeholder when no noticeboard prop is supplied', () => {
    const el = mount();
    renderCircleView(el, { circle, rows, t, onSend: vi.fn(), tabs, activeTab: 'noticeboard' });
    expect(el.querySelector('.cc-noticeboard')).toBeNull();
    expect(el.querySelector('.circle-view__placeholder')).not.toBeNull();
  });
});

// Task #13 Phase 2 — the standing help Q&A lights two dormant restyle seams for real: the per-answer
// transparency badge (payload.provenance) and the LLM-forward consent card (payload.consent).
describe('renderCircleView · help Q&A seams (transparency badge + consent card)', () => {
  const botRow = (opts) => {
    const ev = circleChatMessageEvent({ msgId: 'b1', ts: now, circleId: 'g1', actor: 'bot', text: 'Basis is…', ...opts });
    return [{ id: 'b1', ts: now, app: 'circle', type: 'chat-message', actor: 'bot', circleId: 'g1', event: ev }];
  };

  it('a deterministic hit shows the "answered directly" badge (llmUsed:false)', () => {
    const el = mount();
    renderCircleView(el, { circle, rows: botRow({ provenance: { llmUsed: false } }), t });
    const badge = el.querySelector('.circle-view__bubble-provenance');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('circle.circle.provenance_direct');
  });

  it('an LLM answer stamps a verbatim provenance string', () => {
    const el = mount();
    renderCircleView(el, { circle, rows: botRow({ provenance: '· via de vertrouwelijke assistent' }), t });
    expect(el.querySelector('.circle-view__bubble-provenance').textContent).toBe('· via de vertrouwelijke assistent');
  });

  it('a consent bubble styles as the consent card and renders variant buttons', () => {
    const el = mount();
    renderCircleView(el, {
      circle,
      rows: botRow({ consent: true, buttons: [
        { label: 'ja, doorsturen', action: 'help:consent:yes', variant: 'primary' },
        { label: 'nee, ik kies zelf', action: 'help:consent:no', variant: 'secondary' },
      ] }),
      t, onEmbedButton: vi.fn(),
    });
    expect(el.querySelector('.circle-view__bubble--consent')).not.toBeNull();
    expect(el.querySelector('.circle-view__consent-btn--primary')).not.toBeNull();
    expect(el.querySelector('.circle-view__consent-btn--secondary')).not.toBeNull();
  });
});

describe('renderCircleView · §8 message report affordance', () => {
  const chatRows = [{
    id: 'm1', ts: Date.now(), app: 'household', type: 'chat-message', actor: 'Pieter', circleId: 'g1',
    event: { id: 'm1', type: 'chat-message', payload: { text: 'iets vervelends', senderDisplay: 'Pieter' } },
  }];
  const botRows = [{
    id: 'b1', ts: Date.now(), app: 'household', type: 'chat-message', actor: 'bot', circleId: 'g1',
    event: { id: 'b1', type: 'chat-message', payload: { text: 'hoi' } },
  }];

  it("shows a report button on ANOTHER member's message and fires onReportMessage", () => {
    const el = mount();
    const onReportMessage = vi.fn();
    renderCircleView(el, { circle, rows: chatRows, t, localActor: 'me', onReportMessage });
    const rep = el.querySelector('.circle-view__bubble-report');
    expect(rep).toBeTruthy();
    rep.click();
    expect(onReportMessage).toHaveBeenCalledWith('m1', expect.objectContaining({ id: 'm1' }));
  });

  it('no report button on your OWN message, or on a bot message, or when unwired', () => {
    const own = mount();
    renderCircleView(own, { circle, rows: chatRows, t, localActor: 'Pieter', onReportMessage: () => {} });
    expect(own.querySelector('.circle-view__bubble-report')).toBeNull();

    const bot = mount();
    renderCircleView(bot, { circle, rows: botRows, t, localActor: 'me', onReportMessage: () => {} });
    expect(bot.querySelector('.circle-view__bubble-report')).toBeNull();

    const unwired = mount();
    renderCircleView(unwired, { circle, rows: chatRows, t, localActor: 'me' });
    expect(unwired.querySelector('.circle-view__bubble-report')).toBeNull();
  });
});
