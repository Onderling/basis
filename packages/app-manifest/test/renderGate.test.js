import { describe, it, expect } from 'vitest';
import { renderGate, renderSlash } from '../src/index.js';

// A canopy-chat-tasks-shaped fixture: addTask has a plain `text` param (text-only + drop the
// trailing "to the list" clause); completeTask/claimTask take `id` (match + a CUSTOM arg name).
const tasks = {
  appId: 'tasks',
  operations: [
    { id: 'addTask',      surfaces: { slash: { match: { verbs: ['add', 'todo', 'voeg', 'zet'], body: 'text-only', dropTrailing: ['to', 'aan', 'op', 'toe'] } } } },
    { id: 'completeTask', surfaces: { slash: { match: { verbs: [['klaar', 'met'], 'done', 'complete', 'klaar'], body: 'match', arg: 'id' } } } },
    { id: 'claimTask',    surfaces: { slash: { match: { verbs: ['claim', 'pak'], body: 'match', arg: 'id' } } } },
  ],
};

// Mimic how a token-gate engine consumes the rules: try each in order, first command wins.
function run(rules, text) {
  for (const r of rules) { if (!r.test()) continue; const c = r.command(text); if (c) return c; }
  return null;
}

describe('renderGate — manifest → token-gate rules', () => {
  const rules = renderGate(tasks);

  it('add → opId addTask{text}, dropping the trailing list clause', () => {
    expect(run(rules, 'add milk to the list')).toEqual({ opId: 'addTask', args: { text: 'milk' } });
  });

  it('Dutch separable verb "voeg melk toe" → addTask{text:melk}', () => {
    expect(run(rules, 'voeg melk toe')).toEqual({ opId: 'addTask', args: { text: 'melk' } });
    expect(run(rules, 'zet melk op de lijst')).toEqual({ opId: 'addTask', args: { text: 'melk' } });
  });

  it('done → completeTask with the CUSTOM arg name (id, not match)', () => {
    expect(run(rules, 'done the dishes')).toEqual({ opId: 'completeTask', args: { id: 'the dishes' } });
  });

  it('multiword verb "klaar met X" → completeTask{id:X}', () => {
    expect(run(rules, 'klaar met afwas')).toEqual({ opId: 'completeTask', args: { id: 'afwas' } });
  });

  it('claim → claimTask{id:X}', () => {
    expect(run(rules, 'claim the trash')).toEqual({ opId: 'claimTask', args: { id: 'the trash' } });
  });

  it('skillId is normalized to opId', () => {
    expect(run(rules, 'add eggs').opId).toBe('addTask');
  });

  it('unmatched free text → null (the engine falls through to the LLM)', () => {
    expect(run(rules, 'what is for dinner?')).toBe(null);
  });

  it('several manifests: each is a rule, declaration order, first match wins', () => {
    const stoop = { appId: 'stoop', operations: [{ id: 'markReturned', surfaces: { slash: { match: { verbs: ['returned'], body: 'match', arg: 'id' } } } }] };
    const r2 = renderGate([tasks, stoop]);
    expect(r2).toHaveLength(2);
    expect(run(r2, 'returned the drill')).toEqual({ opId: 'markReturned', args: { id: 'the drill' } });
    expect(run(r2, 'add milk')).toEqual({ opId: 'addTask', args: { text: 'milk' } });
  });

  it('a falsy manifest in the list is skipped', () => {
    expect(renderGate([null, tasks])).toHaveLength(1);
  });
});

describe('renderSlash additive options (arg + dropTrailing) — inert unless declared', () => {
  it('without dropTrailing the trailing clause is kept (household behaviour unchanged)', () => {
    const m = { operations: [{ id: 'addTask', surfaces: { slash: { match: { verbs: ['add'], body: 'text-only' } } } }] };
    expect(renderSlash(m).parse('add milk to the list')).toEqual({ skillId: 'addTask', args: { text: 'milk to the list' } });
  });

  it('without arg the default field name is used', () => {
    const m = { operations: [{ id: 'x', surfaces: { slash: { match: { verbs: ['done'], body: 'match' } } } }] };
    expect(renderSlash(m).parse('done it')).toEqual({ skillId: 'x', args: { match: 'it' } });
  });
});
