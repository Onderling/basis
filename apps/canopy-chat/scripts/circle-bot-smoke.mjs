// Live smoke for the v2 circle free-text→LLM→command chain (C) + the clarification turn, against a
// real local LLM. Run: node scripts/circle-bot-smoke.mjs   (needs an OpenAI-compatible endpoint below)
// Not a unit test (needs a live model) — the deterministic chains are covered by test/v2/*.

import { createCircleTurn } from '../src/v2/circleTurn.js';
import { buildCircleLlmProviders } from '../src/v2/circleLlmProviders.js';
import { createClarifyingDispatch } from '../src/v2/clarifyingDispatch.js';

const BASE  = process.env.VITE_CIRCLE_LLM_BASEURL || 'http://127.0.0.1:11434/v1';
const MODEL = process.env.VITE_CIRCLE_LLM_MODEL   || 'qwen2.5:7b-instruct';
const BOT   = 'assistant';

// A household-circle-shaped catalog (the LLM's tool list). markComplete takes an id-like `target`
// (pickerSource → listOpen) so the clarification turn can resolve a label to a concrete item.
const catalog = { opsById: new Map([
  ['addTask',      { op: { id: 'addTask',      params: [{ name: 'title', kind: 'string', required: true }],
                          surfaces: { chat: { hint: 'add an item/task to the household list' } } } }],
  ['markComplete', { op: { id: 'markComplete', params: [{ name: 'target', kind: 'string', required: true, pickerSource: { listOp: 'listOpen' } }],
                          surfaces: { chat: { hint: 'mark an item complete / done, by its name' } } } }],
  ['listOpen',     { op: { id: 'listOpen',     params: [], surfaces: { chat: { hint: 'list the open items' } } } }],
]) };

// The circle's current open items — TWO match "dishes", so a "mark the dishes" turn is ambiguous.
const LISTING = [
  { id: '01HWASHDISHES0000000A', label: 'wash the dishes' },
  { id: '01HDRYDISHES00000000B', label: 'dry the dishes' },
  { id: '01HTAKEBINS000000000C', label: 'take out the bins' },
];

const providers = buildCircleLlmProviders({ localBaseUrl: BASE, model: MODEL });
const events = [];   // what the shell would do
const clarify = createClarifyingDispatch({
  catalog: () => catalog,
  lookup: () => LISTING,
  dispatchReady: (cmd) => { events.push({ t: 'DISPATCH', cmd }); },
  ask: (q) => { events.push({ t: 'ASK', query: q.query, candidates: q.candidates.map((c) => c.label) }); },
  askMissing: (m) => { events.push({ t: 'NOT-FOUND', query: m.query }); },
});
const handleCircleTurn = createCircleTurn({
  policyFor: () => ({ llmTool: 'local' }),
  llmProviders: providers,
  catalog: () => catalog,
  botName: BOT,
  dispatchCommand: (cmd, scope) => clarify.run(cmd, scope),
});

const scope = { id: 'circle-A' };
const show = (label) => { const e = events.splice(0); console.log(`     ${e.length ? e.map(fmt).join('\n     ') : '·  fell through → kring/normal'}`); };
const fmt = (e) => e.t === 'DISPATCH' ? `→ DISPATCH ${JSON.stringify(e.cmd)}`
  : e.t === 'ASK' ? `❓ ASK "${e.query}" → [${e.candidates.join(' | ')}]`
  : e.t === 'NOT-FOUND' ? `∅ NOT-FOUND "${e.query}"` : JSON.stringify(e);

console.log(`[smoke] BASE=${BASE} MODEL=${MODEL}\n`);
for (const text of [
  '@assistant add milk to the shopping list',
  '@assistent zet afval wegbrengen op de lijst',          // Dutch
  '@assistant mark the dishes as done',                   // AMBIGUOUS → should ASK
  'anyone going to the shop later?',                       // bystander — no dispatch
]) {
  await handleCircleTurn(text, scope);
  console.log(`  ${JSON.stringify(text)}`); show();
}

// Follow up the ambiguous turn: the user picks "dry the dishes".
if (clarify.hasPending(scope)) {
  console.log(`\n  [user taps "dry the dishes"]`);
  await clarify.pick('01HDRYDISHES00000000B', scope);
  show();
}
