// Live smoke for the v2 circle free-text→LLM→command chain (C), against a real local LLM.
// Run: node scripts/circle-bot-smoke.mjs   (needs an OpenAI-compatible endpoint; see BASE/MODEL below)
// Not a unit test (needs a live model) — the deterministic chain is covered by test/v2/*.

import { createCircleTurn } from '../src/v2/circleTurn.js';
import { buildCircleLlmProviders } from '../src/v2/circleLlmProviders.js';

const BASE  = process.env.VITE_CIRCLE_LLM_BASEURL || 'http://127.0.0.1:11434/v1';
const MODEL = process.env.VITE_CIRCLE_LLM_MODEL   || 'qwen2.5:7b-instruct';
const BOT   = 'assistant';

// A household-circle-shaped catalog (the LLM's tool list).
const catalog = { opsById: new Map([
  ['addTask',      { op: { id: 'addTask',      params: [{ name: 'title', kind: 'string', required: true }],
                          surfaces: { chat: { hint: 'add an item/task to the household list' } } } }],
  ['markComplete', { op: { id: 'markComplete', params: [{ name: 'title', kind: 'string', required: true }],
                          surfaces: { chat: { hint: 'mark an item complete / done' } } } }],
  ['listOpen',     { op: { id: 'listOpen',     params: [], surfaces: { chat: { hint: 'list the open items' } } } }],
]) };

const providers = buildCircleLlmProviders({ localBaseUrl: BASE, model: MODEL });
const dispatched = [];
const handleCircleTurn = createCircleTurn({
  policyFor: () => ({ llmTool: 'local' }),
  llmProviders: providers,
  catalog: () => catalog,
  botName: BOT,
  dispatchCommand: (cmd) => { dispatched.push(cmd); },
});

const cases = [
  '@assistant add milk to the shopping list',
  '@assistent zet afval wegbrengen op de lijst',          // Dutch
  'assistant, what is still open?',
  '@assistant mark the dishes as done',
  'anyone going to the shop later?',                       // bystander — must NOT dispatch
  'add milk',                                              // not addressed — must NOT dispatch
];

console.log(`[smoke] BASE=${BASE} MODEL=${MODEL}\n`);
for (const text of cases) {
  dispatched.length = 0;
  let handled = false, err = null;
  try { handled = await handleCircleTurn(text, { id: 'circle-A' }); }
  catch (e) { err = e.message; }
  const out = err ? `ERROR ${err}` : handled ? JSON.stringify(dispatched[0]) : '(fell through → kring/normal)';
  console.log(`  ${handled ? '→ DISPATCH' : '·  pass  '}  ${JSON.stringify(text)}\n               ${out}`);
}
