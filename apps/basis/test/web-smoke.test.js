/**
 * basis — web smoke test.  v0.1.4 end-to-end with happy-dom.
 *
 * Drives the same pipeline `web/main.js` does, against a fresh
 * happy-dom environment.  Asserts that:
 *   1. typing '/mine' renders a list of 3 chores
 *   2. tapping the [Mark done] button on Dishwasher dispatches
 *      markComplete + renders ✓ confirmation
 *   3. typing '/mine' again renders 2 chores (the disabled
 *      action menu above stays in DOM but greyed)
 *
 * @vitest-environment happy-dom
 */
import { describe, it, expect } from 'vitest';

import {
  parseInput, mergeManifests, resolveDispatch, runDispatch,
  renderReply, Thread,
} from '../src/index.js';
import { renderStream }              from '../src/web/domAdapter.js';
import { createMockHouseholdAgent }  from '../src/core/agent/mockAgent.js';

function makeApp() {
  const agent   = createMockHouseholdAgent();
  const catalogue = mergeManifests([{ manifest: agent.manifest }]);
  const thread  = new Thread();
  const manifestsByOrigin = { household: agent.manifest };
  const container = document.createElement('div');
  document.body.appendChild(container);

  const ctxBase = { doc: document };

  async function handleUserText(text) {
    thread.addUserMessage(text);
    const parse = parseInput(text, catalogue);
    const route = resolveDispatch(parse, catalogue);
    if (route.kind !== 'ready') {
      const rendered = renderReply({
        payload: `unhandled: ${route.kind}`, shape: 'text',
      });
      thread.addShellMessage(rendered);
      return;
    }
    const reply = await runDispatch(route, agent.callSkill);
    const rendered = renderReply(reply, {
      appOrigin: route.appOrigin, manifestsByOrigin,
    });
    thread.addShellMessage(rendered, { opId: route.opId });
  }

  async function onButtonTap(opId, itemId) {
    thread.addUserMessage(`(tap: ${opId} ${itemId})`);
    const entry    = catalogue.opsById.get(opId);
    const firstReq = (entry.op.params ?? []).find(
      (p) => p?.required && (p.kind === 'string' || p.kind === 'enum'),
    );
    const args = firstReq ? { [firstReq.name]: itemId } : { id: itemId };
    const parse = { kind: 'slash', opId, args, threadId: null,
                    command: '(button)', body: itemId };
    const route = resolveDispatch(parse, catalogue);
    if (route.kind !== 'ready') return;
    const reply = await runDispatch(route, agent.callSkill);
    const rendered = renderReply(reply, {
      appOrigin: route.appOrigin, manifestsByOrigin,
    });
    thread.addShellMessage(rendered, { opId: route.opId });
  }

  function rerender() {
    renderStream(container, thread.messages, { ...ctxBase, onButtonTap });
  }

  return { agent, catalogue, thread, container, handleUserText, onButtonTap, rerender };
}

describe('basis v0.1.4 web smoke', () => {
  it("'/mine' then click [Done] on Dishwasher then '/mine' again", async () => {
    const app = makeApp();

    /* turn 1 — list */
    await app.handleUserText('/mine');
    app.rerender();

    const lists1 = app.container.querySelectorAll('.cc-list');
    expect(lists1.length).toBe(1);
    expect(lists1[0].classList.contains('cc-live')).toBe(true);
    const items1 = lists1[0].querySelectorAll('.cc-list-item');
    expect(items1.length).toBe(3);

    /* find Dishwasher's [Mark done] button + click it */
    const dishwasherRow = [...items1].find((li) =>
      li.querySelector('.cc-item-label').textContent === 'Dishwasher',
    );
    expect(dishwasherRow.dataset.itemId).toBe('c-1');
    const btn = dishwasherRow.querySelector('.cc-keyboard-btn');
    expect(btn.dataset.callback).toBe('markComplete:c-1');
    btn.click();

    // The handler is async — wait microtasks.
    await new Promise((r) => setTimeout(r, 0));
    app.rerender();

    /* a "tap" user message + a ✓ shell reply should now exist */
    const replies = app.container.querySelectorAll('.cc-shell.cc-text');
    expect(replies.length).toBeGreaterThanOrEqual(1);
    const lastReply = replies[replies.length - 1].querySelector('.cc-bubble').textContent;
    expect(lastReply).toBe('✓ Done: Dishwasher');

    /* the prior list should now be in 'disabled' state */
    const lists2 = app.container.querySelectorAll('.cc-list');
    const firstList = lists2[0];
    expect(firstList.classList.contains('cc-disabled')).toBe(true);
    const firstListBtn = firstList.querySelector('.cc-keyboard-btn');
    expect(firstListBtn.disabled).toBe(true);

    /* turn 2 — list again, now with 2 items */
    await app.handleUserText('/mine');
    app.rerender();
    const allLists = app.container.querySelectorAll('.cc-list');
    const latest = allLists[allLists.length - 1];
    expect(latest.classList.contains('cc-live')).toBe(true);
    const items2 = latest.querySelectorAll('.cc-list-item');
    expect(items2.length).toBe(2);
    const labels = [...items2].map((li) =>
      li.querySelector('.cc-item-label').textContent,
    );
    expect(labels.sort()).toEqual(['Bins out', 'Vacuum living room']);
  });

  it("unknown command renders an explainer", async () => {
    const app = makeApp();
    await app.handleUserText('hello');
    app.rerender();
    const lastBubble = [...app.container.querySelectorAll('.cc-shell .cc-bubble')].at(-1);
    expect(lastBubble.textContent).toMatch(/unhandled: unknown/);
  });
});
