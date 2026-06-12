// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest';
import { renderCircleKring } from '../../web/v2/circleKring.js';
import { createInputHistory } from '../../src/v2/commandSuggest.js';

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

const rows = [
  // newest-first (matches buildKringStream output)
  {
    id: 'r3', ts: now,        app: 'household', type: 'chat-message',
    actor: 'Pieter', circleId: 'g1',
    event: { id: 'r3', type: 'chat-message', payload: { text: 'Bedankt!', senderDisplay: 'Pieter' } },
  },
  {
    id: 'r2', ts: now - 60_000, app: 'stoop', type: 'buurt-post',
    actor: 'Pieter', circleId: 'g1',
    event: { id: 'r2', type: 'buurt-post', payload: { kind: 'aanbod', text: 'Boekje te geef.', authorName: 'Pieter' } },
  },
  {
    id: 'r1', ts: yest, app: 'stoop', type: 'buurt-post',
    actor: 'Anne', circleId: 'g1',
    event: { id: 'r1', type: 'buurt-post', payload: { kind: 'vraag', text: 'Heeft iemand een ladder t/m vrijdag?', authorName: 'Anne' } },
  },
];

describe('renderCircleKring · SP-13.2 chat-style kring view', () => {
  it('renders header (back + title + members meta)', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t });
    expect(el.querySelector('.circle-kring__back').textContent).toBe('circle.back');
    expect(el.querySelector('.circle-kring__title').textContent).toBe('Selwerd');
    expect(el.querySelector('.circle-kring__meta').textContent).toBe('circle.members:87');
  });

  it('renders message bubbles chronologically (oldest at top)', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t });
    const bubbles = el.querySelectorAll('.circle-kring__bubble');
    expect([...bubbles].map((b) => b.dataset.rowId)).toEqual(['r1', 'r2', 'r3']);
  });

  it('groups bubbles under dated day-dividers', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t });
    const days = el.querySelectorAll('.circle-kring__day');
    expect(days.length).toBe(2);
    // First divider = yesterday's date (precedes r1).
    expect(days[0].textContent).toBe('circle.kring.day_yesterday');
    // Second divider = today's date (precedes r2 + r3).
    expect(days[1].textContent).toBe('circle.kring.day_today');
  });

  it('shows a KIND pill on bubbles whose payload carries a kind ≠ message', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t });
    const bubbles = el.querySelectorAll('.circle-kring__bubble');
    // r1 vraag, r2 aanbod, r3 chat-message (no pill).
    expect(bubbles[0].querySelector('.circle-kring__bubble-kind').textContent).toBe('VRAAG');
    expect(bubbles[1].querySelector('.circle-kring__bubble-kind').textContent).toBe('AANBOD');
    expect(bubbles[2].querySelector('.circle-kring__bubble-kind')).toBeNull();
  });

  it('renders sender label + body text + substrate action chips', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t });
    const bubbles = el.querySelectorAll('.circle-kring__bubble');
    // r1 = vraag → [help, ignore] via streamActions.
    expect(bubbles[0].querySelector('.circle-kring__bubble-sender').textContent).toBe('Anne');
    expect(bubbles[0].querySelector('.circle-kring__bubble-text').textContent)
      .toBe('Heeft iemand een ladder t/m vrijdag?');
    const acts = bubbles[0].querySelectorAll('.circle-kring__bubble-action');
    expect([...acts].map((b) => b.dataset.action)).toEqual(['help', 'ignore']);
  });

  it('renders the inline composer when onSend is wired', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t });
    expect(el.querySelector('.circle-kring__composer')).toBeNull();

    const el2 = mount();
    const onSend = vi.fn();
    renderCircleKring(el2, { circle, rows, t, onSend });
    const form  = el2.querySelector('.circle-kring__composer');
    const input = el2.querySelector('.circle-kring__composer-input');
    expect(form).not.toBeNull();
    expect(input.placeholder).toBe('circle.kring.composer_placeholder');
  });

  it('composer submit fires onSend(text) and clears the input', () => {
    const el = mount();
    const onSend = vi.fn();
    renderCircleKring(el, { circle, rows, t, onSend });
    const input = el.querySelector('.circle-kring__composer-input');
    const form  = el.querySelector('.circle-kring__composer');
    input.value = '  Hoi buurt!  ';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0][0]).toBe('Hoi buurt!');
    expect(input.value).toBe('');
  });

  it('composer ignores empty / whitespace-only submits', () => {
    const el = mount();
    const onSend = vi.fn();
    renderCircleKring(el, { circle, rows, t, onSend });
    const input = el.querySelector('.circle-kring__composer-input');
    const form  = el.querySelector('.circle-kring__composer');
    input.value = '   ';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('composer honors a kring-specific placeholder when the host passes one', () => {
    const el = mount();
    renderCircleKring(el, {
      circle, rows, t, onSend: () => {},
      composerPlaceholder: 'Schrijf naar de buurt…',
    });
    expect(el.querySelector('.circle-kring__composer-input').placeholder)
      .toBe('Schrijf naar de buurt…');
  });

  it('empty state shows when rows = []', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows: [], t });
    expect(el.querySelector('.circle-kring__empty').textContent).toBe('circle.kring.empty');
    expect(el.querySelectorAll('.circle-kring__bubble')).toHaveLength(0);
  });

  it('overflow menu hides until a `more` action is provided + toggles on click', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t });
    expect(el.querySelector('.circle-kring__more')).toBeNull();

    const el2 = mount();
    const onSettings = vi.fn();
    renderCircleKring(el2, { circle, rows, t, more: { settings: onSettings } });
    const trigger = el2.querySelector('.circle-kring__more');
    expect(trigger).not.toBeNull();
    const menu = el2.querySelector('.circle-kring__more-menu');
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
    renderCircleKring(el, { circle, rows, t, onAction });
    el.querySelector('.circle-kring__bubble .circle-kring__bubble-action[data-action=help]').click();
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onAction.mock.calls[0][0].action).toBe('help');
    expect(onAction.mock.calls[0][1].id).toBe('r1');
  });

  /* ─── SP-13.3 — per-kring bottom tabs ─── */

  const buurtTabs = [
    { id: 'gesprek',  label: 'GESPREK' },
    { id: 'prikbord', label: 'PRIKBORD' },
    { id: 'leden',    label: 'LEDEN' },
  ];

  it('tab bar hides when fewer than 2 tabs are supplied', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t, tabs: [{ id: 'gesprek', label: 'GESPREK' }] });
    expect(el.querySelector('.circle-kring__tabs')).toBeNull();
  });

  it('renders one tab button per entry with the active one marked', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t, tabs: buurtTabs, activeTab: 'prikbord' });
    const btns = el.querySelectorAll('.circle-kring__tab');
    expect([...btns].map((b) => b.dataset.tab)).toEqual(['gesprek', 'prikbord', 'leden']);
    expect(el.querySelector('.circle-kring__tab.is-active').dataset.tab).toBe('prikbord');
  });

  it('non-GESPREK tabs render the placeholder body (V0 of SP-13.3)', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t, tabs: buurtTabs, activeTab: 'prikbord' });
    expect(el.querySelector('.circle-kring__placeholder')).not.toBeNull();
    // Bubble list is suppressed for non-chat tabs.
    expect(el.querySelectorAll('.circle-kring__bubble')).toHaveLength(0);
  });

  it('GESPREK tab still renders the bubble list', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t, tabs: buurtTabs, activeTab: 'gesprek' });
    expect(el.querySelector('.circle-kring__placeholder')).toBeNull();
    expect(el.querySelectorAll('.circle-kring__bubble')).toHaveLength(3);
  });

  it('clicking a non-active tab fires onTab(id); clicking the active one is a no-op', () => {
    const el = mount();
    const onTab = vi.fn();
    renderCircleKring(el, { circle, rows, t, tabs: buurtTabs, activeTab: 'gesprek', onTab });
    el.querySelector('.circle-kring__tab[data-tab=leden]').click();
    expect(onTab).toHaveBeenCalledTimes(1);
    expect(onTab.mock.calls[0][0]).toBe('leden');
    el.querySelector('.circle-kring__tab[data-tab=gesprek]').click();
    expect(onTab).toHaveBeenCalledTimes(1); // unchanged — re-tap on active = no-op
  });

  it('defaults activeTab to the first tab id when caller omits it', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t, tabs: buurtTabs });
    expect(el.querySelector('.circle-kring__tab.is-active').dataset.tab).toBe('gesprek');
  });

  it('composer stays visible regardless of active tab (v2 §1 boards)', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t, tabs: buurtTabs, activeTab: 'leden', onSend: () => {} });
    expect(el.querySelector('.circle-kring__composer')).not.toBeNull();
  });

  /* ─── SP-13.4 — Chat ↔ Scherm header pill (v2 §4 "De Schakelaar") ─── */

  it('view-toggle pill hides unless onViewMode is wired', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t });
    expect(el.querySelector('.circle-kring__view-toggle')).toBeNull();
  });

  it('renders both Chat and Scherm buttons with the active one marked', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t, viewMode: 'chat', onViewMode: () => {} });
    const btns = el.querySelectorAll('.circle-kring__view-toggle-btn');
    expect([...btns].map((b) => b.dataset.viewMode)).toEqual(['chat', 'scherm']);
    expect(el.querySelector('.circle-kring__view-toggle-btn.is-active').dataset.viewMode).toBe('chat');
    expect(btns[0].getAttribute('aria-pressed')).toBe('true');
    expect(btns[1].getAttribute('aria-pressed')).toBe('false');
  });

  it('clicking the inactive view-toggle fires onViewMode; clicking the active one is a no-op', () => {
    const el = mount();
    const onViewMode = vi.fn();
    renderCircleKring(el, { circle, rows, t, viewMode: 'chat', onViewMode });
    el.querySelector('.circle-kring__view-toggle-btn[data-view-mode=scherm]').click();
    expect(onViewMode).toHaveBeenCalledTimes(1);
    expect(onViewMode.mock.calls[0][0]).toBe('scherm');
    el.querySelector('.circle-kring__view-toggle-btn[data-view-mode=chat]').click();
    expect(onViewMode).toHaveBeenCalledTimes(1); // unchanged — re-tap on active = no-op
  });

  it('scherm-mode renders the screen body (α.1c) and suppresses bubbles', () => {
    // No screenBlocks wired → renderCircleScreen falls through to its
    // own empty-state.  The body must contain a circle-screen subtree
    // (not chat bubbles).
    const el = mount();
    renderCircleKring(el, { circle, rows, t, viewMode: 'scherm', onViewMode: () => {} });
    expect(el.querySelector('.circle-screen')).not.toBeNull();
    expect(el.querySelector('.circle-screen__empty').textContent).toBe('circle.screen.empty');
    expect(el.querySelectorAll('.circle-kring__bubble')).toHaveLength(0);
  });

  it('scherm-mode with screenBlocks renders each materialized block', () => {
    const el = mount();
    const blocks = [
      { blockId: 'b1', type: 'announcement', status: 'ok', content: { text: 'Hi!' } },
      { blockId: 'b2', type: 'text',         status: 'ok', content: { text: 'meer hier' } },
    ];
    renderCircleKring(el, {
      circle, rows, t,
      viewMode: 'scherm', onViewMode: () => {},
      screenBlocks: blocks,
    });
    expect(el.querySelectorAll('.circle-screen__block')).toHaveLength(2);
    expect(el.querySelector('.circle-screen__block--announcement')).not.toBeNull();
    expect(el.querySelector('.circle-screen__block--text')).not.toBeNull();
  });

  it('scherm-mode suppresses the composer even when onSend is wired', () => {
    const el = mount();
    renderCircleKring(el, {
      circle, rows, t, viewMode: 'scherm', onViewMode: () => {}, onSend: () => {},
    });
    expect(el.querySelector('.circle-kring__composer')).toBeNull();
  });

  it('scherm-mode suppresses the bottom tab bar even when ≥ 2 tabs are wired', () => {
    const el = mount();
    renderCircleKring(el, {
      circle, rows, t, viewMode: 'scherm', onViewMode: () => {}, tabs: buurtTabs,
    });
    expect(el.querySelector('.circle-kring__tabs')).toBeNull();
  });

  /* ─── δ.2 — per-message delivery state ─── */

  // Local-actor rows mimic what showKring's onSend appends: actor === LOCAL_ACTOR
  // and type === 'chat-message'.  Buurt-post mirrors are NOT locally-sent so
  // they never get a delivery icon, even when the actor coincidentally matches.
  const LOCAL = 'me';
  const localRow = {
    id: 'mine-1', ts: now + 5_000, app: 'kring', type: 'chat-message',
    actor: LOCAL, circleId: 'g1',
    event: { id: 'mine-1', type: 'chat-message', payload: { text: 'Hallo!', kind: 'chat-message' } },
  };

  it('locally-sent bubble shows a clock icon when delivery state is pending', () => {
    const el = mount();
    renderCircleKring(el, {
      circle, rows: [localRow], t,
      deliveryStateFor: (id) => (id === 'mine-1' ? 'pending' : null),
      localActor: LOCAL,
    });
    const bubble = el.querySelector('[data-row-id="mine-1"]');
    const icon = bubble.querySelector('.circle-kring__bubble-delivery--pending');
    expect(icon).not.toBeNull();
    expect(icon.getAttribute('aria-label')).toBe('circle.chat.delivery.pending');
  });

  it('clock icon disappears once delivery state flips to sent (happy path = no icon)', () => {
    const el = mount();
    renderCircleKring(el, {
      circle, rows: [localRow], t,
      deliveryStateFor: () => 'sent',
      localActor: LOCAL,
    });
    const bubble = el.querySelector('[data-row-id="mine-1"]');
    expect(bubble.querySelector('.circle-kring__bubble-delivery')).toBeNull();
  });

  it('failed state renders a warning button + tap fires onRetryDelivery(msgId)', () => {
    const el = mount();
    const onRetryDelivery = vi.fn();
    renderCircleKring(el, {
      circle, rows: [localRow], t,
      deliveryStateFor: () => 'failed',
      localActor: LOCAL,
      onRetryDelivery,
    });
    const btn = el.querySelector('.circle-kring__bubble-delivery--failed');
    expect(btn).not.toBeNull();
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('aria-label')).toBe('circle.chat.delivery.failed');
    btn.click();
    expect(onRetryDelivery).toHaveBeenCalledTimes(1);
    expect(onRetryDelivery).toHaveBeenCalledWith('mine-1');
  });

  it('peer messages (actor ≠ local) never get a delivery icon, even with state set', () => {
    const el = mount();
    renderCircleKring(el, {
      circle, rows, t,                              // rows[0] = Anne (not LOCAL)
      deliveryStateFor: () => 'pending',
      localActor: LOCAL,
    });
    expect(el.querySelector('.circle-kring__bubble-delivery')).toBeNull();
  });

  it('non-chat-message local rows (e.g. buurt-post mirror) get no delivery icon', () => {
    const el = mount();
    const localPost = {
      id: 'mine-buurt', ts: now + 1_000, app: 'stoop', type: 'buurt-post',
      actor: LOCAL, circleId: 'g1',
      event: { id: 'mine-buurt', type: 'buurt-post', payload: { kind: 'aanbod', text: 'Hi' } },
    };
    renderCircleKring(el, {
      circle, rows: [localPost], t,
      deliveryStateFor: () => 'pending',
      localActor: LOCAL,
    });
    expect(el.querySelector('.circle-kring__bubble-delivery')).toBeNull();
  });

  it('no delivery icon renders when the host omits the delivery-state plumbing', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows: [localRow], t });
    expect(el.querySelector('.circle-kring__bubble-delivery')).toBeNull();
  });
});

describe('renderCircleKring · composer parity (slash-suggest + permission gate)', () => {
  const catalog = { opsById: new Map([
    ['addTask',      { op: { id: 'addTask',      surfaces: { slash: { command: '/addtask' },       chat: { hint: 'add a task' } } } }],
    ['completeTask', { op: { id: 'completeTask', surfaces: { slash: { command: '/complete-task' }, chat: { hint: 'finish a task' } } } }],
  ]) };

  it('permission gate: canPost=false renders a read-only note in place of the composer', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t, onSend: () => {}, canPost: false });
    expect(el.querySelector('.circle-kring__composer')).toBeNull();
    const note = el.querySelector('.circle-kring__composer-disabled');
    expect(note).not.toBeNull();
    expect(note.textContent).toBe('circle.kring.chat_disabled');
  });

  it('permission gate: canPost (default) renders the composer form, no note', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t, onSend: () => {} });
    expect(el.querySelector('.circle-kring__composer')).not.toBeNull();
    expect(el.querySelector('.circle-kring__composer-disabled')).toBeNull();
  });

  it('slash-suggest: typing "/" opens the dropdown; a space (into args) closes it', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t, onSend: () => {}, catalog });
    const input = el.querySelector('.circle-kring__composer-input');
    const suggest = el.querySelector('.circle-kring__suggest');
    input.value = '/';
    input.dispatchEvent(new Event('input'));
    expect(suggest.hidden).toBe(false);
    expect(el.querySelectorAll('.circle-kring__suggest-item').length).toBe(2);
    input.value = '/addtask milk';
    input.dispatchEvent(new Event('input'));
    expect(suggest.hidden).toBe(true);
  });

  it('slash-suggest: a prefix filters the list', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t, onSend: () => {}, catalog });
    const input = el.querySelector('.circle-kring__composer-input');
    input.value = '/comp';
    input.dispatchEvent(new Event('input'));
    expect([...el.querySelectorAll('.circle-kring__suggest-cmd')].map((n) => n.textContent)).toEqual(['/complete-task']);
  });

  it('no catalog → no suggest dropdown wiring (composer still works)', () => {
    const el = mount();
    renderCircleKring(el, { circle, rows, t, onSend: () => {} });
    const input = el.querySelector('.circle-kring__composer-input');
    input.value = '/';
    input.dispatchEvent(new Event('input'));
    expect(el.querySelector('.circle-kring__suggest').hidden).toBe(true);
  });

  it('history: submit records the message into the injected history (ArrowUp would recall it)', () => {
    const el = mount();
    const history = createInputHistory();
    const onSend = vi.fn();
    renderCircleKring(el, { circle, rows, t, onSend, catalog, history });
    const input = el.querySelector('.circle-kring__composer-input');
    input.value = 'hello kring';
    el.querySelector('.circle-kring__composer').dispatchEvent(new Event('submit'));
    expect(onSend).toHaveBeenCalledWith('hello kring');
    expect(history.prev()).toBe('hello kring');
  });
});
