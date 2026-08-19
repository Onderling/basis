// @vitest-environment happy-dom
//
// Taken (tasks) tab — the circle view lists a circle's tasks (via the shared
// buildTaskRows) with their lifecycle chips + the owner-only entrust chip, and
// tapping entrust reaches the host so the mandate picker opens. Replaces the old
// "vervolg-slice" placeholder.
import { describe, it, expect, vi } from 'vitest';
import { renderCircleView } from '../../web/v2/circleView.js';
import { buildTaskRows } from '../../src/v2/taskRows.js';

const t = (key, params) => (params && params.count != null ? `${key}:${params.count}` : key);

function mount() {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

const circle = { id: 'huis', name: 'Huishouden', memberCount: 3 };
const tabs = [{ id: 'gesprek', label: 'Gesprek' }, { id: 'taken', label: 'Taken' }];

describe('renderCircleView · Taken tab', () => {
  it('renders task rows (not the tab-coming placeholder)', () => {
    const el = mount();
    const tasks = buildTaskRows([
      { id: 'task-1', text: 'Afwas doen', state: 'open' },
      { id: 'task-2', text: 'Vuilnis buiten', state: 'claimed' },
    ], { circleId: 'huis' });
    renderCircleView(el, { circle, rows: [], tabs, activeTab: 'taken', tasks, t });

    expect(el.querySelector('.circle-circle__placeholder')).toBeNull();
    const cards = el.querySelectorAll('.circle-circle__task');
    expect(cards.length).toBe(2);
    expect(cards[0].querySelector('.circle-circle__task-text').textContent).toBe('Afwas doen');
    expect(cards[0].dataset.taskId).toBe('task-1');
    // The true lifecycle status shows (not the mapped chip-kind).
    expect(cards[0].querySelector('.circle-circle__task-status').textContent).toBe('circle.taskStatus.open');
    expect(cards[1].querySelector('.circle-circle__task-status').textContent).toBe('circle.taskStatus.claimed');
  });

  it('shows a friendly empty state (not the placeholder) when there are no tasks', () => {
    const el = mount();
    renderCircleView(el, { circle, rows: [], tabs, activeTab: 'taken', tasks: [], t });
    expect(el.querySelector('.circle-circle__placeholder')).toBeNull();
    expect(el.querySelector('.circle-circle__taken-empty').textContent).toBe('circle.circle.taken_empty');
  });

  it('an open task row surfaces claim + snooze + the owner-only entrust chip (viewer is admin)', () => {
    const el = mount();
    const tasks = buildTaskRows([{ id: 'task-1', text: 'X', state: 'open' }], { circleId: 'huis' });
    renderCircleView(el, { circle, rows: [], tabs, activeTab: 'taken', tasks, viewerIsAdmin: true, t });
    const chips = [...el.querySelectorAll('.circle-circle__task .circle-circle__bubble-action')].map((b) => b.dataset.action);
    expect(chips).toContain('claim');
    expect(chips).toContain('snooze');
    expect(chips).toContain('mandate');
    expect(el.querySelector('.circle-circle__bubble-action--mandate')).not.toBeNull();
  });

  it('tapping the entrust chip calls onAction with the mandate action (carrying the taskId) → host opens the picker', () => {
    const el = mount();
    const onAction = vi.fn();
    const tasks = buildTaskRows([{ id: 'task-42', text: 'X', state: 'open' }], { circleId: 'huis' });
    renderCircleView(el, { circle, rows: [], tabs, activeTab: 'taken', tasks, viewerIsAdmin: true, onAction, t });
    el.querySelector('.circle-circle__bubble-action--mandate').click();
    expect(onAction).toHaveBeenCalledTimes(1);
    const [action] = onAction.mock.calls[0];
    expect(action.action).toBe('mandate');
    expect(action.payload.taskId).toBe('task-42');
  });

  it('the compose affordance calls onAddTask', () => {
    const el = mount();
    const onAddTask = vi.fn();
    renderCircleView(el, { circle, rows: [], tabs, activeTab: 'taken', tasks: [], onAddTask, t });
    const add = el.querySelector('.circle-circle__taken-add');
    expect(add).not.toBeNull();
    add.click();
    expect(onAddTask).toHaveBeenCalledTimes(1);
  });
});
