/**
 * Part A (PLAN-manifest-gate-surfaces) — `createGate` unit tests.
 *
 * `createGate` lifts the deterministic token-gate RULES to the host level: it
 * composes app manifests (a mounted host, a list, or a single manifest) into
 * gate rules via app-manifest's `renderGate`, keeping the SAME semantics/output.
 *
 * Coverage:
 *   - rules project from a manifest list; text → { opId, args, appOrigin }
 *   - PARITY: createGate(list).rules matches renderGate(list) exactly (opId/args)
 *   - composes from a mounted manifest-host (host.manifests())
 *   - single manifest (not a list) is accepted
 *   - first-match-wins across apps preserves declaration order
 *   - opts ({ locale, trailLexicon }) forwarded → trailing-verb pass works
 */

import { describe, it, expect } from 'vitest';

import { renderGate } from '@onderling/app-manifest';
import { createManifestHost } from '../src/ManifestHost.js';
import { createGate } from '../src/createGate.js';

/* ─── synthetic gate-declaring manifests ─────────────────────────────── */

const tasksLike = {
  app: 'tasks',
  systemPrompt: 'tasks assistant',
  itemTypes: ['task'],
  operations: [
    {
      id:     'addTask',
      verb:   'add',
      params: [{ name: 'text', kind: 'string', required: true }],
      surfaces: {
        chat:  { hint: 'Add a task' },
        slash: { command: '/add', body: { kind: 'text-only' },
                 match: { verbs: ['add'], body: 'text-only' } },
      },
    },
    {
      id:        'completeTask',
      verb:      'done',
      appliesTo: { type: 'task', state: 'open' },
      params:    [{ name: 'id', kind: 'string', required: true }],
      surfaces:  {
        chat:  { hint: 'Complete a task' },
        slash: { command: '/done',
                 match: { verbs: ['done', 'complete'], body: 'match', arg: 'id', trailing: 'complete' } },
      },
    },
  ],
};

const pinboardLike = {
  app: 'pinboard',
  systemPrompt: 'pinboard assistant',
  itemTypes: ['post'],
  operations: [
    {
      id:     'postRequest',
      verb:   'post',
      params: [{ name: 'text', kind: 'string', required: true }],
      surfaces: {
        chat:  { hint: 'Post a request' },
        slash: { command: '/post', body: { kind: 'text-only' },
                 match: { verbs: ['post'], body: 'text-only' } },
      },
    },
  ],
};

// Per-locale trailing lexicon: "<X> done" → completeTask (mirrors circleGateLexicon shape).
const TRAIL = { en: { complete: ['done'] }, nl: { complete: ['klaar'] } };

function stubRegistry(manifest) {
  const out = {};
  for (const op of manifest.operations) out[op.id] = async () => ({ replies: [], stateUpdates: [] });
  return out;
}

/* ─── tests ──────────────────────────────────────────────────────────── */

describe('createGate', () => {
  it('projects rules from a manifest list; text routes to { opId, args, appOrigin }', () => {
    const { rules } = createGate([tasksLike, pinboardLike]);
    expect(Array.isArray(rules)).toBe(true);
    // Rule name derives from appId ?? id ?? index (renderGate); these fixtures use `app`, so index.
    expect(rules.map((r) => r.name)).toEqual(['manifest:0', 'manifest:1']);

    const firstHit = (text) => {
      for (const r of rules) { const c = r.command(text); if (c) return c; }
      return null;
    };
    expect(firstHit('add buy milk')).toEqual({ opId: 'addTask', args: { text: 'buy milk' }, appOrigin: 'tasks' });
    expect(firstHit('done t1')).toEqual({ opId: 'completeTask', args: { id: 't1' }, appOrigin: 'tasks' });
    expect(firstHit('post need a drill')).toEqual({ opId: 'postRequest', args: { text: 'need a drill' }, appOrigin: 'pinboard' });
    expect(firstHit('ramble with no verb')).toBeNull();
  });

  it('PARITY: createGate(list).rules === renderGate(list) (name/opId/args identical)', () => {
    const opts = { locale: 'en', trailLexicon: TRAIL };
    const list = [tasksLike, pinboardLike];
    const gated = createGate(list, opts).rules;
    const direct = renderGate(list, opts);

    expect(gated.length).toBe(direct.length);
    const probes = ['add paint hallway', 'done t9', 'sok done', 'post lend me a ladder', 'nothing here'];
    for (let i = 0; i < direct.length; i++) {
      expect(gated[i].name).toBe(direct[i].name);
      for (const p of probes) {
        expect(gated[i].command(p)).toEqual(direct[i].command(p));
      }
    }
  });

  it('composes from a mounted manifest-host (host.manifests() in mount order)', () => {
    const host = createManifestHost();
    host.mount('tasks', tasksLike, { skillRegistry: stubRegistry(tasksLike), toSkillCtx: (c) => c });
    host.mount('pinboard', pinboardLike, { skillRegistry: stubRegistry(pinboardLike), toSkillCtx: (c) => c });

    const { rules } = createGate(host);
    // Same rules a plain list of the same manifests would yield.
    const direct = renderGate([tasksLike, pinboardLike]);
    expect(rules.map((r) => r.name)).toEqual(direct.map((r) => r.name));
    expect(rules[0].command('add wash car')).toEqual(direct[0].command('add wash car'));
  });

  it('accepts a single manifest (not a list)', () => {
    const { rules } = createGate(tasksLike);
    expect(rules).toHaveLength(1);
    expect(rules[0].command('add feed cat')).toEqual({ opId: 'addTask', args: { text: 'feed cat' }, appOrigin: 'tasks' });
  });

  it('first-match-wins preserves declaration order across apps', () => {
    // Give pinboard a colliding "add" verb; whichever app is FIRST in the list wins.
    const pinboardAdds = { ...pinboardLike, operations: [
      { id: 'addPost', verb: 'add', params: [{ name: 'text', kind: 'string', required: true }],
        surfaces: { chat: { hint: 'x' }, slash: { command: '/addp', body: { kind: 'text-only' },
                    match: { verbs: ['add'], body: 'text-only' } } } },
    ] };
    const firstHit = (rules, text) => { for (const r of rules) { const c = r.command(text); if (c) return c; } return null; };

    const tasksFirst = createGate([tasksLike, pinboardAdds]).rules;
    expect(firstHit(tasksFirst, 'add x')).toMatchObject({ opId: 'addTask', appOrigin: 'tasks' });

    const pinboardFirst = createGate([pinboardAdds, tasksLike]).rules;
    expect(firstHit(pinboardFirst, 'add x')).toMatchObject({ opId: 'addPost', appOrigin: 'pinboard' });
  });

  it('forwards opts ({ locale, trailLexicon }) → trailing-verb pass', () => {
    const en = createGate([tasksLike], { locale: 'en', trailLexicon: TRAIL }).rules;
    // "sok done" (trailing verb) only routes when the lexicon/locale is forwarded.
    expect(en[0].command('sok done')).toEqual({ opId: 'completeTask', args: { id: 'sok' }, appOrigin: 'tasks' });

    const bare = createGate([tasksLike]).rules;               // no opts → trailing inert
    expect(bare[0].command('sok done')).toBeNull();
  });
});
