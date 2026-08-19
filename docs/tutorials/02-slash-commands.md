# Tutorial 2 — one manifest, every surface

Declare an app's operations **once**, in a manifest — and project that single declaration into a
slash-command grammar, an AI tool catalogue, and dispatchable skill handlers. This is the core
pattern of the platform: interfaces are pass-throughs; the manifest is the contract.

Runnable version: [`apps/sdk-journeys/j2-slash-bot.mjs`](../../apps/sdk-journeys/j2-slash-bot.mjs).

## 1. Author the manifest

```js
import { validateManifest, renderSlash, renderChat } from '@onderling/app-manifest';
import { createAgent, wireSkill } from '@onderling/sdk';

const manifest = {
  app:       'notebot',
  itemTypes: ['note'],
  operations: [
    {
      id:        'addNote',
      verb:      'add',
      appliesTo: { type: 'note' },
      params: [
        { name: 'text', kind: 'string', required: true, schema: { minLength: 1 } },
      ],
      surfaces: {
        slash: { command: '/note', match: { verbs: ['note', 'remember'], body: 'text-only' } },
        chat:  { reply: 'text', hint: 'Save a note for later.' },
      },
    },
    {
      id:        'listNotes',
      verb:      'list',
      appliesTo: { type: 'note' },
      params:    [],
      surfaces: {
        slash: { command: '/notes', match: { verbs: ['notes', ['list', 'notes']], body: 'none' } },
        chat:  { reply: 'list', hint: 'List every saved note.' },
      },
    },
  ],
};

validateManifest(manifest, { strict: true });   // → { ok: true, errors: [], warnings: [] }
```

## 2. Project surface one: slash commands

`renderSlash` compiles a deterministic parser — no language model involved:

```js
const slash = renderSlash(manifest);

slash.parse('remember the milk');
// → { skillId: 'addNote', args: { text: 'the milk' } }
slash.parse('notes');
// → { skillId: 'listNotes', args: {} }
```

## 3. Wire the operations onto an agent

`wireSkill` generates the handler *from* the operation declaration: it decodes the incoming
parts, validates `args` against `op.params`, resolves the per-scope store, and calls your core
function:

```js
const store = { notes: [] };
const cores = {
  addNote:   (s, args) => { s.notes.push(args.text); return { saved: args.text, count: s.notes.length }; },
  listNotes: (s)       => ({ notes: [...s.notes] }),
};

const agent = await createAgent({ label: 'notebot' });
for (const op of manifest.operations) {
  agent.register(op.id, wireSkill(cores[op.id], op, { storeFor: () => store }));
}
```

## 4. Project surface two: the AI tool catalogue

The *same* declaration compiles into tools an LLM can call — each with a JSON schema derived
from `op.params` and a description from the chat hint:

```js
const chat = renderChat(manifest, {
  skillRegistry: Object.fromEntries(manifest.operations.map((op) => [op.id, () => null])),
  toSkillCtx:    (toolCtx) => toolCtx,
});

chat.toolCatalogue.map((t) => t.id);   // → ['addNote', 'listNotes']
```

The projector output is the platform's narrow waist — `{ opId, args }` — so a parsed slash
command, an LLM tool call, and a GUI button press all dispatch identically. Your bot's operations
are now drivable from any Onderling client, including surfaces you never wrote.

Next: [Tutorial 3 — a compatible tasks app](03-compatible-tasks-app.md).
