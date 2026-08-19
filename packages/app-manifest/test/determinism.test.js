/**
 * Determinism gate.  Same manifest → byte-identical output across runs;
 * declaration order preserved. This is what makes 's byte-equivalence
 * gate (PLAN §1.4) possible.
 */

import { describe, it, expect } from 'vitest';
import {
  paramsToJsonSchema,
  renderChat,
  renderSlash,
} from '../src/index.js';

const fixture = {
  app:       'demo',
  itemTypes: ['note', 'task'],
  operations: [
    {
      id:    'addNote',
      verb:  'add',
      params: [
        { name: 'type', kind: 'enum', of: 'itemTypes', required: true },
        { name: 'text', kind: 'string', required: true },
      ],
      surfaces: {
        chat:  { hint: 'add a note' },
        slash: { command: '/add', match: { verbs: ['add'], body: 'type+text' } },
      },
    },
    {
      id:        'claim',
      verb:      'claim',
      appliesTo: { type: 'task', state: 'open' },
      params:    [],
      surfaces: {
        chat: { hint: "I'll take it" },
        ui:   { control: 'button', label: 'Take' },
      },
    },
  ],
  views: [
    { id: 'notes', title: 'Notes', type: 'note' },
    { id: 'tasks', title: 'Tasks', type: 'task' },
  ],
};

const skillRegistry = {
  addNote: async () => ({ replies: [], stateUpdates: [] }),
  claim:   async () => ({ replies: [], stateUpdates: [] }),
};
const toSkillCtx = (c) => ({ chatId: c?.chatId });

describe('determinism', () => {
  it('paramsToJsonSchema preserves param declaration order', () => {
    const out = paramsToJsonSchema(fixture.operations[0].params, { manifest: fixture });
    expect(Object.keys(out.properties)).toEqual(['type', 'text']);
    expect(out.required).toEqual(['type', 'text']);
  });

  it('renderChat output is identical across runs and follows op order', () => {
    const a = renderChat(fixture, { skillRegistry, toSkillCtx });
    const b = renderChat(fixture, { skillRegistry, toSkillCtx });

    const serialise = (out) => JSON.stringify({
      toolCatalogue: out.toolCatalogue,
      systemPrompt: out.systemPrompt,
      commandMenu: out.commandMenu,
    });

    expect(serialise(a)).toBe(serialise(b));
    expect(a.toolCatalogue.map((t) => t.id)).toEqual(['addNote', 'claim']);
    // commandMenu only includes ops with surfaces.slash.command — claim has no slash.
    expect(a.commandMenu.map((c) => c.command)).toEqual(['/add']);
  });

  it('renderSlash compiles deterministically; parse output stable for same input', () => {
    const a = renderSlash(fixture);
    const b = renderSlash(fixture);
    const r1 = a.parse('add note hello');
    const r2 = b.parse('add note hello');
    expect(JSON.stringify(r1)).toBe(JSON.stringify(r2));
  });
});
