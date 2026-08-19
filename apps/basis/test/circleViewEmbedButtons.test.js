/**
 * S6.A — manifest-driven inline buttons render on a bot reply in the v2 circle
 * chat (the resurrected "inline menu") + a tap fires onEmbedButton with the
 * op + item. @vitest-environment happy-dom
 */
import { describe, it, expect, vi } from 'vitest';
import { renderCircleView } from '../web/v2/circleView.js';

const t = (k) => k;

// A bot chat-row carrying inline manifest buttons on its event payload (the
// shape circleChatMessageEvent produces: payload.buttons).
const botRowWithButtons = (buttons) => ({
  id: 'circle-c1-bot-1', ts: Date.now(), type: 'chat-message', actor: 'bot',
  circleId: 'c1',
  event: { id: 'circle-c1-bot-1', ts: Date.now(), type: 'chat-message', actor: 'bot', payload: { circleId: 'c1', text: '✓ Added: boodschappen', kind: 'chat-message', buttons } },
});

describe('renderCircleView — S6.A inline embed buttons', () => {
  it('renders payload.buttons on a bot row + a tap dispatches {opId,itemId}', () => {
    const onEmbedButton = vi.fn();
    const el = renderCircleView(document.createElement('div'), {
      circle: { id: 'c1', name: 'Buren' }, t,
      activeTab: 'conversation',
      rows: [botRowWithButtons([
        { id: 'claimTask:t1', label: 'Claim · boodschappen', opId: 'claimTask', itemId: 't1' },
      ])],
      onEmbedButton,
    });
    const btn = el.querySelector('.circle-view__embed-button');
    expect(btn).toBeTruthy();
    expect(btn.textContent).toMatch(/Claim/);
    expect(btn.dataset.opId).toBe('claimTask');
    expect(btn.dataset.itemId).toBe('t1');
    btn.click();
    expect(onEmbedButton).toHaveBeenCalledWith(expect.objectContaining({ opId: 'claimTask', itemId: 't1' }));  // whole button passed (47c630c1)
  });

  it('S6.B — renders a screen button (opens a panel) + a tap fires onEmbedButton with {screen}', () => {
    const onEmbedButton = vi.fn();
    const el = renderCircleView(document.createElement('div'), {
      circle: { id: 'c1' }, t, activeTab: 'conversation',
      rows: [botRowWithButtons([{ id: 'screen:tasks', label: 'All tasks →', screen: 'tasks' }])],
      onEmbedButton,
    });
    const btn = el.querySelector('.circle-view__screen-button');
    expect(btn).toBeTruthy();
    expect(btn.dataset.screen).toBe('tasks');
    expect(btn.dataset.opId).toBeUndefined();
    btn.click();
    expect(onEmbedButton).toHaveBeenCalledWith(expect.objectContaining({ screen: 'tasks' }));
  });

  it('scope badge — a circle-scoped bot reply shows "whole circle"; default/self shows "only you"', () => {
    const circleRow = { id: 'k1', ts: Date.now(), type: 'chat-message', actor: 'bot', circleId: 'c1',
      event: { type: 'chat-message', actor: 'bot', payload: { circleId: 'c1', text: '✓ Posted', kind: 'chat-message', scope: 'circle' } } };
    const selfRow = { id: 'k2', ts: Date.now(), type: 'chat-message', actor: 'bot', circleId: 'c1',
      event: { type: 'chat-message', actor: 'bot', payload: { circleId: 'c1', text: 'private answer', kind: 'chat-message' } } };
    const el = renderCircleView(document.createElement('div'), {
      circle: { id: 'c1' }, t, activeTab: 'conversation', rows: [circleRow, selfRow],
    });
    const badges = [...el.querySelectorAll('.circle-view__scope')];
    expect(badges).toHaveLength(2);
    expect(el.querySelector('.circle-view__scope--circle').textContent).toContain('circle.scope.circle');
    expect(el.querySelector('.circle-view__scope--self').textContent).toContain('circle.scope.self');
  });

  it('renders no embed buttons when the row carries none', () => {
    const el = renderCircleView(document.createElement('div'), {
      circle: { id: 'c1' }, t, activeTab: 'conversation',
      rows: [botRowWithButtons(undefined)],
      onEmbedButton: () => {},
    });
    expect(el.querySelector('.circle-view__embed-button')).toBeNull();
  });

  it('skips embed buttons when no onEmbedButton handler is wired', () => {
    const el = renderCircleView(document.createElement('div'), {
      circle: { id: 'c1' }, t, activeTab: 'conversation',
      rows: [botRowWithButtons([{ id: 'x:1', label: 'X', opId: 'x', itemId: '1' }])],
    });
    expect(el.querySelector('.circle-view__embed-button')).toBeNull();
  });
});

describe('renderCircleView — embeds[] "See also" chips on a bot row', () => {
  const botRowWithEmbeds = (embeds) => ({
    id: 'circle-c1-bot-2', ts: Date.now(), type: 'chat-message', actor: 'bot', circleId: 'c1',
    event: { id: 'circle-c1-bot-2', ts: Date.now(), type: 'chat-message', actor: 'bot',
      payload: { circleId: 'c1', text: '✓ Added: Fix the gate', kind: 'chat-message', embeds } },
  });

  it('renders a chip per embed the message carries (icon + type + title)', () => {
    const el = renderCircleView(document.createElement('div'), {
      circle: { id: 'c1' }, t, activeTab: 'conversation',
      rows: [botRowWithEmbeds([{ type: 'task', ref: 't2', title: 'Fix the gate' }])],
    });
    const chips = el.querySelectorAll('.circle-view__embed');
    expect(chips).toHaveLength(1);
    expect(chips[0].dataset.ref).toBe('t2');
    expect(chips[0].textContent).toBe('✅ task: Fix the gate');   // identity t() → raw type fallback
  });

  it('renders no embeds block when the message carries none', () => {
    const el = renderCircleView(document.createElement('div'), {
      circle: { id: 'c1' }, t, activeTab: 'conversation', rows: [botRowWithEmbeds(undefined)],
    });
    expect(el.querySelector('.circle-view__embeds')).toBeNull();
  });

  it('a task chip is TAPPABLE (a button) + a tap opens the tasks screen', () => {
    const onEmbedOpen = vi.fn();
    const el = renderCircleView(document.createElement('div'), {
      circle: { id: 'c1' }, t, activeTab: 'conversation',
      rows: [botRowWithEmbeds([{ type: 'task', ref: 't2', title: 'Fix the gate' }])],
      onEmbedOpen,
    });
    const chip = el.querySelector('.circle-view__embed--tappable');
    expect(chip).toBeTruthy();
    expect(chip.tagName).toBe('BUTTON');
    chip.click();
    expect(onEmbedOpen).toHaveBeenCalledWith({ type: 'task', ref: 't2', screen: 'tasks' });
  });

  it('a chip with no screen (note) stays a non-tappable span even with onEmbedOpen', () => {
    const el = renderCircleView(document.createElement('div'), {
      circle: { id: 'c1' }, t, activeTab: 'conversation',
      rows: [botRowWithEmbeds([{ type: 'note', ref: 'n1', title: 'A note' }])],
      onEmbedOpen: vi.fn(),
    });
    expect(el.querySelector('.circle-view__embed--tappable')).toBeNull();
    expect(el.querySelector('.circle-view__embed').tagName).toBe('SPAN');
  });
});
