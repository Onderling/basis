/**
 * J2 — slash bot: a bot that exposes its operations via a declarative
 * manifest instead of hand-written command parsing.
 *
 * The imagined developer: someone building a small utility bot (here: a
 * note-keeping bot) who wants slash commands AND an AI tool catalogue without
 * writing either surface by hand. They author one `manifest.js`, validate
 * it, and let the pure projectors derive every surface.
 *
 * What it proves: `@onderling/app-manifest` + `@onderling/sdk` suffice to
 *   1. author a small manifest (two operations over the canonical `note` type),
 *   2. validate it strictly (`validateManifest` with `strict: true`),
 *   3. project it — `renderSlash` compiles the deterministic slash grammar,
 *      `renderChat` compiles the AI tool catalogue — from the same declaration,
 *   4. dispatch a parsed command through the platform waist: the projector's
 *      `{ skillId, args }` output is exactly the `{ opId, args }` shape that
 *      `callSkill` consumes, handled by a `wireSkill`-generated handler.
 *
 * Everything here runs offline in one Node process.
 */
import assert from 'node:assert/strict';
import { validateManifest, renderSlash, renderChat } from '@onderling/app-manifest';
import { createAgent, wireSkill, Parts } from '@onderling/sdk';

function step(n, text) { console.log(`  ${n}. ${text}`); }

console.log('J2 slash-bot — one manifest, projected to slash + chat, dispatched at the waist');

// ── 1. Author the manifest — the single contract for every surface ─────────
const manifest = {
  app:       'notebot',
  itemTypes: ['note'],                       // canonical in @onderling/item-types
  operations: [
    {
      id:        'addNote',
      verb:      'add',
      appliesTo: { type: 'note' },
      params: [
        { name: 'text', kind: 'string', required: true, schema: { minLength: 1 } },
      ],
      surfaces: {
        slash: {
          command: '/note',
          match:   { verbs: ['note', 'remember'], body: 'text-only' },
        },
        chat: { reply: 'text', hint: 'Save a note for later.' },
      },
    },
    {
      id:        'listNotes',
      verb:      'list',
      appliesTo: { type: 'note' },
      params:    [],
      surfaces: {
        slash: {
          command: '/notes',
          match:   { verbs: ['notes', ['list', 'notes']], body: 'none' },
        },
        chat: { reply: 'list', hint: 'List every saved note.' },
      },
    },
  ],
};
step(1, `authored a manifest: app "${manifest.app}", ${manifest.operations.length} operations over the canonical "note" type`);

// ── 2. Validate it strictly ─────────────────────────────────────────────────
const check = validateManifest(manifest, { strict: true });
assert.equal(check.ok, true, `manifest must validate strictly (errors: ${JSON.stringify(check.errors)})`);
assert.equal(check.errors.length, 0, 'no validation errors');
step(2, `validateManifest(strict) → ok, ${check.errors.length} errors, ${check.warnings.length} warnings`);

// ── 3a. Project the slash surface — a deterministic parser, no LLM ──────────
const slash = renderSlash(manifest);
const parsed = slash.parse('remember the milk');
assert.ok(parsed, 'slash grammar matched the free-text command');
assert.equal(parsed.skillId, 'addNote', 'parsed to the addNote operation');
assert.equal(parsed.args.text, 'the milk', 'body captured as the declared text param');
const parsedList = slash.parse('notes');
assert.equal(parsedList.skillId, 'listNotes', '"notes" parsed to the listNotes operation');
step(3, `renderSlash: "remember the milk" → ${JSON.stringify(parsed)}`);

// ── 3b. Wire the operations onto an agent (manifest op → skill handler) ────
// The handlers are generated FROM the manifest ops by wireSkill: decode parts
// → validate args against op.params → resolve the scope store → run the core.
const notes = [];                                     // the bot's scope store
const store = { notes };
const cores = {
  addNote:   (s, args) => { s.notes.push(args.text); return { saved: args.text, count: s.notes.length }; },
  listNotes: (s)       => ({ notes: [...s.notes] }),
};
const agent = await createAgent({ label: 'notebot' });
for (const op of manifest.operations) {
  agent.register(op.id, wireSkill(cores[op.id], op, { storeFor: () => store }));
}
step(4, 'registered one wireSkill-generated handler per manifest operation');

// ── 3c. Project the chat surface — the AI tool catalogue from the same ops ───
const chat = renderChat(manifest, {
  skillRegistry: Object.fromEntries(manifest.operations.map((op) => [op.id, () => null])),
  toSkillCtx:    (toolCtx) => toolCtx,
});
const toolIds = chat.toolCatalogue.map((t) => t.id).sort();
assert.deepEqual(toolIds, ['addNote', 'listNotes'], 'chat tool catalogue covers exactly the manifest ops');
const addTool = chat.toolCatalogue.find((t) => t.id === 'addNote');
assert.ok(addTool.schema, 'each tool carries a JSON schema derived from op.params');
assert.equal(addTool.description, 'Save a note for later.', 'tool description comes from the chat hint');
step(5, `renderChat: tool catalogue [${toolIds.join(', ')}] with JSON schemas — same declaration, second surface`);

// ── 4. Dispatch the parsed op through the waist ─────────────────────────────
// The projector output IS the waist shape: { opId, args } → callSkill.
const addResult = await agent.invoke(agent.address, parsed.skillId, Parts.wrap(parsed.args));
assert.equal(Parts.data(addResult).saved, 'the milk', 'dispatch stored the note');

const listResult = await agent.invoke(agent.address, parsedList.skillId, Parts.wrap(parsedList.args));
assert.deepEqual(Parts.data(listResult).notes, ['the milk'], 'the listed notes reflect the earlier dispatch');
step(6, `dispatched { opId: "${parsed.skillId}", args } at the waist → notes now ${JSON.stringify(Parts.data(listResult).notes)}`);

// Required params are enforced by the generated handler, not by hand.
await assert.rejects(
  () => agent.invoke(agent.address, 'addNote', Parts.wrap({})),
  /text/,
  'the wireSkill handler rejects a missing required param',
);
step(7, 'missing required param "text" is rejected by the manifest-derived validation');

await agent.stop();

console.log('✓ J2 slash-bot: PASS');
