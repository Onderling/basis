/**
 * EVERY SURFACE ASKS THE ONE FOLD (Frits 2026-09-25: fold the four gates, deny-wins).
 *
 * `opAvailability` composes the circle's gates — is its app composed here, is its feature on, may this member do
 * it — deny-wins, with a reason. Until now only the attach menu asked it; the other surfaces each applied the
 * gates their author knew: slash-suggest the app gate only, the inline reply buttons the capability gate only,
 * the ⋯ roster the feature gate only. So a person was offered, on one surface, an op another surface knew was
 * off. Each projection takes the availability and drops (or greys) what the fold says, and asks nothing else of
 * its own when it has one.
 *
 * A stub availability drives these: the fold's own rules are `opAvailability.test.js`'s; this pins that each
 * surface CONSULTS it.
 */
import { describe, it, expect } from 'vitest';
import { createComposerCommands } from '../../src/v2/composerCommands.js';
import { embedButtonsForReply } from '../../src/v2/replyEmbeds.js';
import { gatedActions } from '../../src/v2/actionProjection.js';

const stub = (states) => ({ of: (opId) => ({ state: states[opId] ?? 'available', reason: states[opId] ? 'feature-off' : null }) });

describe('slash-suggest asks the fold', () => {
  const catalogue = { opsById: new Map([
    ['addTask', { appOrigin: 'tasks', op: { id: 'addTask', surfaces: { slash: { command: '/taak' } } } }],
    ['addNote', { appOrigin: 'notes', op: { id: 'addNote', surfaces: { slash: { command: '/notitie' } } } }],
  ]) };
  it('a command whose op is off in this circle is not suggested, nor parsed as one', () => {
    const c = createComposerCommands({ kind: 'circle', catalogue, availability: stub({ addNote: 'hidden' }) });
    const offered = c.pool.map((e) => e.command);
    expect(offered).toContain('/taak');
    expect(offered).not.toContain('/notitie');
    expect(c.suggest('/no').map((e) => e.command)).not.toContain('/notitie');
  });
  it('without an availability nothing changes', () => {
    const c = createComposerCommands({ kind: 'circle', catalogue });
    expect(c.pool.map((e) => e.command)).toEqual(expect.arrayContaining(['/taak', '/notitie']));
  });
});

describe('inline reply buttons ask the fold', () => {
  const manifestsByOrigin = { tasks: { app: 'tasks', operations: [
    { id: 'claimTask',    verb: 'claim',    appliesTo: { type: 'task' }, surfaces: { ui: { control: 'button', label: 'Claim' } } },
    { id: 'completeTask', verb: 'complete', appliesTo: { type: 'task' }, surfaces: { ui: { control: 'button', label: 'Done' } } },
  ] } };
  const reply = { task: { id: 't1', type: 'task', title: 'brood halen', status: 'open' } };
  it('a hidden op gets no button; a greyed one is disabled', () => {
    const base = embedButtonsForReply({ reply, appOrigin: 'tasks', manifestsByOrigin });
    expect(base.length, `the fixture yields buttons: ${JSON.stringify(base)}`).toBeGreaterThan(0);
    const ops = base.map((b) => b.opId);
    const [first, second] = ops;
    const states = { [first]: 'hidden', ...(second ? { [second]: 'greyed' } : {}) };
    const out = embedButtonsForReply({ reply, appOrigin: 'tasks', manifestsByOrigin, availability: stub(states) });
    expect(out.map((b) => b.opId)).not.toContain(first);
    if (second) expect(out.find((b) => b.opId === second)?.disabled).toBe(true);
  });
});

describe('the ⋯ roster asks the fold for its op entries', () => {
  const manifest = { app: 'x', actions: [
    { id: 'settings', labelKey: 'a.settings', target: { kind: 'op', opId: 'settings' } },
    { id: 'invite', labelKey: 'a.invite', target: { kind: 'nav', to: 'invite' } },
  ], operations: [{ id: 'settings', verb: 'get' }] };
  const renderer = (m) => ({ actions: m.actions });
  it('an op entry the fold hides is dropped; nav entries keep their own gate', () => {
    const out = gatedActions(manifest, { renderer, availability: stub({ settings: 'hidden' }) });
    expect(out.map((a) => a.id)).toEqual(['invite']);
  });
  it('a greyed op entry stays, disabled', () => {
    const out = gatedActions(manifest, { renderer, availability: stub({ settings: 'greyed' }) });
    expect(out.find((a) => a.id === 'settings')?.disabled).toBe(true);
  });
});
