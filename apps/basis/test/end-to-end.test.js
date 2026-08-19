/**
 * basis — v0.1.2 end-to-end integration test.
 *
 * Exercises the full pipeline as a single user session:
 *   parse → resolve → dispatch → render → thread state
 *
 * Proves the J1 dishwasher journey works end-to-end with the
 * deterministic v0.1 logic: user lists, picks via fuzzy match,
 * marks done, sees the action-menu disable.
 */
import { describe, it, expect } from 'vitest';

import {
  parseInput, mergeManifests, resolveDispatch, runDispatch,
  renderReply, Thread,
} from '../src/index.js';

const householdManifest = {
  app:       'household',
  itemTypes: ['chore'],
  operations: [
    {
      id: 'listOpen', verb: 'list', params: [],
      surfaces: { slash: { command: '/mine' }, chat: { reply: 'list', hint: 'list open chores' } },
    },
    {
      id: 'markComplete', verb: 'complete',
      appliesTo: { type: 'chore', state: 'open' },
      params: [{ name: 'choreId', kind: 'string', required: true }],
      surfaces: {
        slash: { command: '/done' },
        chat:  { reply: 'text', hint: 'mark a chore complete' },
        ui:    { control: 'button', label: 'Mark done' },
      },
    },
  ],
  views: [{ id: 'chores', title: 'Chores', type: 'chore' }],
};

const chores = [
  { id: 'c-1', label: 'Dishwasher',         type: 'chore', state: 'open' },
  { id: 'c-2', label: 'Bins out',           type: 'chore', state: 'open' },
  { id: 'c-3', label: 'Vacuum living room', type: 'chore', state: 'open' },
];

describe('basis v0.1.2 — J1 dishwasher journey end-to-end', () => {
  it('user lists, picks via fuzzy match, marks done, action menu disables', async () => {
    /* setup */
    const catalogue = mergeManifests([{ manifest: householdManifest }]);
    const thread  = new Thread({ id: 'main' });
    const manifestsByOrigin = { household: householdManifest };

    // Fake agent skill registry — household pretends to be online.
    const skillCalls = [];
    const callSkill = async (appOrigin, opId, args) => {
      skillCalls.push({ appOrigin, opId, args });
      if (opId === 'listOpen')     return { items: chores };
      if (opId === 'markComplete') return { ok: true, message: `✓ Done: ${args.choreId}` };
      throw new Error('unknown skill');
    };

    /* turn 1 — user lists */
    thread.addUserMessage('/mine');
    {
      const parse = parseInput('/mine', catalogue, { threadId: thread.id });
      const route = resolveDispatch(parse, catalogue);
      expect(route.kind).toBe('ready');
      expect(route.opId).toBe('listOpen');
      const reply = await runDispatch(route, callSkill);
      const rendered = renderReply(reply, {
        appOrigin: route.appOrigin, manifestsByOrigin,
      });
      thread.addShellMessage(rendered, { opId: route.opId });
    }

    /* assert: list rendered with action buttons; cached for fuzzy */
    const listMsg = thread.tail(1)[0];
    expect(listMsg.rendered.kind).toBe('list');
    expect(listMsg.lifecycleState).toBe('live');
    expect(listMsg.rendered.items.length).toBe(3);
    expect(listMsg.rendered.items[0]).toEqual({
      id: 'c-1', label: 'Dishwasher',
      buttons: [{ label: 'Mark done', callbackData: 'markComplete:c-1' }],
    });
    expect(thread.lastListingFor('listOpen').items.length).toBe(3);

    /* turn 2 — user picks via fuzzy: "dishwasher" → resolves to c-1 */
    const fuzzy = thread.resolveFuzzy('listOpen', 'dishwasher');
    expect(fuzzy).toBe('c-1');

    /* turn 2 cont — user fires the slash with the resolved id */
    thread.addUserMessage('/done dishwasher');

    /* assert: previous list-shape action menu flipped 'live' → 'disabled' */
    expect(thread.messages.find((m) => m.messageId === listMsg.messageId).lifecycleState)
      .toBe('disabled');

    {
      // Simulate the chat shell substituting the resolved id for _match.
      const parse = parseInput(`/done ${fuzzy}`, catalogue, { threadId: thread.id });
      const route = resolveDispatch(parse, catalogue);
      expect(route.kind).toBe('ready');
      expect(route.args).toEqual({ choreId: 'c-1' });
      const reply = await runDispatch(route, callSkill);
      const rendered = renderReply(reply, {
        appOrigin: route.appOrigin, manifestsByOrigin,
      });
      thread.addShellMessage(rendered);
    }

    /* assert: confirmation rendered as text */
    const lastReply = thread.tail(1)[0];
    expect(lastReply.rendered.kind).toBe('text');
    expect(lastReply.rendered.text).toBe('✓ Done: c-1');

    /* assert: only 2 skill calls (listOpen + markComplete) */
    expect(skillCalls).toEqual([
      { appOrigin: 'household', opId: 'listOpen',     args: {} },
      { appOrigin: 'household', opId: 'markComplete', args: { choreId: 'c-1' } },
    ]);

    /* full transcript shape */
    expect(thread.messages.map((m) => m.origin)).toEqual([
      'user', 'shell', 'user', 'shell',
    ]);
  });

  it('unknown command → unknown route → no skill call', async () => {
    const catalogue = mergeManifests([{ manifest: householdManifest }]);
    const thread  = new Thread();

    thread.addUserMessage('hello');
    const parse = parseInput('hello', catalogue, { threadId: thread.id });
    const route = resolveDispatch(parse, catalogue);
    expect(route.kind).toBe('unknown');

    // Chat shell renders an "I didn't understand" message (mocked here).
    const rendered = renderReply({
      payload: 'Didn\'t understand "hello". Try /mine or /done.',
      shape:   'text', threadId: thread.id,
    });
    thread.addShellMessage(rendered);

    expect(thread.tail(1)[0].rendered.text)
      .toMatch(/Didn't understand/);
  });
});
