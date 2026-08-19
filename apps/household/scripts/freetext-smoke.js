#!/usr/bin/env node
/**
 * freetext-smoke.js — multi-model atomic smoke for the
 * free-text experiment.
 *
 * Each fixture is **atomic**: a single user turn against a store
 * that the runner pre-populates directly (no LLM-driven setup).
 * This avoids cascading failures — if the LLM doesn't add an item
 * in a setup turn, every downstream check fails for a reason
 * unrelated to the capability we're testing.  With direct setup,
 * each test attributes a single capability cleanly.
 *
 * A handful of fixtures still have multi-turn `turns: [...]` to
 * exercise sequential workflows (e.g. show → tap → confirm) where
 * the multi-turn-ness is the point.
 *
 * Configuration (env):
 *   HOUSEHOLD_LLM_PROVIDER   ollama (default) | openai | anthropic
 *   HOUSEHOLD_LLM_MODELS     comma-separated model list
 *                            (default: 3 local 7B models)
 *   HOUSEHOLD_LLM_BASE_URL   override default base URL
 *   HOUSEHOLD_SMOKE_FILTER   substring filter on fixture name
 *   HOUSEHOLD_SMOKE_NOWARM   set to 1 to skip the pre-warm call
 *
 * Usage:
 *   npm run freetext-smoke --prefix apps/household
 *   HOUSEHOLD_LLM_MODELS=qwen2.5:3b-instruct npm run freetext-smoke --prefix apps/household
 *   HOUSEHOLD_SMOKE_FILTER=remove npm run freetext-smoke --prefix apps/household
 */

import { ChatAgent, InMemoryBridge } from '@onderling/chat-agent';

import { LlmClient }      from '../src/llm/LlmClient.js';
import { ollamaProvider } from '../src/llm/providers/ollama.js';

import {
  TOOL_CATALOGUE,
  createListStore,
  createToolHandlers,
  createContextBuilder,
  pickPrompt,
  parseLlmOptions,
} from './lib/freetext-core.js';

// Resolved once at module load so all fixtures use the same prompt
// + options across a smoke run.
const SYSTEM_PROMPT  = pickPrompt(process.env.HOUSEHOLD_PROMPT);
const LLM_OPTIONS    = parseLlmOptions();
const ACTIVE_PROMPT  = (process.env.HOUSEHOLD_PROMPT ?? 'default').toLowerCase();

// ─── Fixtures — atomic, with explicit setup ─────────────────────

/**
 * @typedef {object} TurnExpect
 * @property {string[]} [toolIds]
 *   Multiset of tool ids that should fire.  ['addToList','addToList']
 *   = exactly two.  []  = no tool calls at all.
 * @property {Record<string, string[]>} [argSets]
 *   Per tool id, the set of expected primary-arg values
 *   (item / match).  Order doesn't matter; case-insensitive.
 * @property {string} [listName]
 *   When given, every tool call this turn must use this listName
 *   (catches translation bugs: "boodschappen" → "shopping").
 * @property {boolean} [hasButtons]
 *   When true, at least one bridge.sendReply must include
 *   buttons (showList result).
 * @property {string|RegExp} [replyContains]
 *   Substring or regex the bot's reply text must include.
 * @property {boolean} [allowExtraTools]
 *   When true, extras beyond toolIds don't fail.  Default false.
 */

/**
 * @typedef {object} Fixture
 * @property {string} name
 * @property {Record<string, string[]>} [setup]
 *   Pre-populated list state.  Keys are list names, values are
 *   item arrays.  Applied directly to the in-memory store before
 *   the LLM ever runs — so the contextBuilder shows the LLM the
 *   intended starting state.
 * @property {string|string[]} turn
 *   Single user input, OR an array of inputs for a multi-turn
 *   workflow.
 * @property {TurnExpect|TurnExpect[]} expect
 *   Single TurnExpect (atomic) or array (one per turn).
 */

/** @type {Fixture[]} */
const FIXTURES = [
  // ── ADD operations ──────────────────────────────────────────────
  {
    name: 'add 3 items (direct phrasing)',
    lite: true,
    setup: {},
    turn:  'voeg kaas, boter en peren toe aan boodschappen',
    expect: {
      toolIds:  ['addToList', 'addToList', 'addToList'],
      argSets:  { addToList: ['kaas', 'boter', 'peren'] },
      listName: 'boodschappen',
    },
  },
  {
    name: 'add 3 items (polite phrasing — "wil je…")',
    lite: true,
    setup: {},
    turn:  'Wil je kaas, boter en peren toevoegen aan boodschappen?',
    expect: {
      toolIds:  ['addToList', 'addToList', 'addToList'],
      argSets:  { addToList: ['kaas', 'boter', 'peren'] },
      listName: 'boodschappen',
    },
  },
  {
    name: 'add via "Wil je <lijst> bijhouden met X en Y"',
    lite: true,
    setup: { boodschappen: ['existing'] },     // pre-populated like real session
    turn:  'Wil je mn boodschappen lijst bijhouden met appels en kaas',
    expect: {
      toolIds:  ['addToList', 'addToList'],
      argSets:  { addToList: ['appels', 'kaas'] },
      listName: 'boodschappen',
    },
  },
  {
    name: 'add to a new list (klusjes)',
    setup: {},
    turn:  'kun je een kluslijst maken met timmeren, zagen en hakken?',
    expect: {
      toolIds:  ['addToList', 'addToList', 'addToList'],
      argSets:  { addToList: ['timmeren', 'zagen', 'hakken'] },
      listName: 'klusjes',
    },
  },
  {
    name: 'add to existing list (extending)',
    setup: { boodschappen: ['melk', 'brood'] },
    turn:  'kun je ook eieren en kaas toevoegen?',
    expect: {
      toolIds:  ['addToList', 'addToList'],
      argSets:  { addToList: ['eieren', 'kaas'] },
      listName: 'boodschappen',
    },
  },

  // ── SHOW operations (4 phrasings, populated list) ───────────────
  {
    name: 'show list (toon de …)',
    lite: true,
    setup: { boodschappen: ['appels', 'peren'] },
    turn:  'toon de boodschappen',
    expect: { toolIds: ['showList'], listName: 'boodschappen', hasButtons: true },
  },
  {
    name: 'show list (wat staat er op …)',
    setup: { boodschappen: ['appels', 'peren'] },
    turn:  'wat staat er op de boodschappen?',
    expect: { toolIds: ['showList'], listName: 'boodschappen', hasButtons: true },
  },
  {
    name: 'show list (laat … zien)',
    setup: { boodschappen: ['appels', 'peren'] },
    turn:  'laat de boodschappenlijst zien',
    expect: { toolIds: ['showList'], listName: 'boodschappen', hasButtons: true },
  },
  {
    name: 'show list (open …)',
    setup: { boodschappen: ['appels', 'peren'] },
    turn:  'open de boodschappen',
    expect: { toolIds: ['showList'], listName: 'boodschappen', hasButtons: true },
  },
  {
    name: 'show non-default list (klusjes)',
    setup: { klusjes: ['timmeren', 'zagen'], boodschappen: ['melk'] },
    turn:  'wat staat er op klusjes?',
    expect: { toolIds: ['showList'], listName: 'klusjes', hasButtons: true },
  },

  // ── REMOVE operations ──────────────────────────────────────────
  {
    name: 'remove via "ik heb X"',
    lite: true,
    setup: { boodschappen: ['melk', 'brood', 'kaas'] },
    turn:  'ik heb melk',
    expect: {
      toolIds: ['removeFromList'],
      argSets: { removeFromList: ['melk'] },
    },
  },
  {
    name: 'remove via "X is klaar"',
    setup: { klusjes: ['timmeren', 'zagen'] },
    turn:  'timmeren is klaar',
    expect: {
      toolIds: ['removeFromList'],
      argSets: { removeFromList: ['timmeren'] },
    },
  },
  {
    name: 'remove via "haal X van …"',
    setup: { boodschappen: ['melk', 'brood'] },
    turn:  'haal brood van de boodschappen',
    expect: {
      toolIds:  ['removeFromList'],
      argSets:  { removeFromList: ['brood'] },
      listName: 'boodschappen',
    },
  },
  {
    name: 'button-tap synth ("ik heb X van Y")',
    setup: { boodschappen: ['appels', 'peren'] },
    turn:  'ik heb appels van boodschappen',
    expect: {
      toolIds:  ['removeFromList'],
      argSets:  { removeFromList: ['appels'] },
      listName: 'boodschappen',
    },
  },

  // ── Contrast pairs — same prefix, opposite intent ─────────────
  {
    name: 'contrast: "ik heb X" → REMOVE (already on list)',
    setup: { boodschappen: ['melk', 'brood'] },
    turn:  'ik heb melk',
    expect: {
      toolIds: ['removeFromList'],
      argSets: { removeFromList: ['melk'] },
    },
  },
  {
    name: 'contrast: "ik heb X nodig" → ADD',
    setup: {},
    turn:  'ik heb melk nodig',
    expect: {
      toolIds:  ['addToList'],
      argSets:  { addToList: ['melk'] },
      listName: 'boodschappen',
    },
  },
  {
    name: 'contrast: "kunnen we X kopen" → ADD',
    setup: {},
    turn:  'kunnen we kaas kopen?',
    expect: {
      toolIds:  ['addToList'],
      argSets:  { addToList: ['kaas'] },
      listName: 'boodschappen',
    },
  },
  {
    name: 'contrast: "we hebben geen X meer" → ADD',
    setup: {},
    turn:  'we hebben geen brood meer',
    expect: {
      toolIds:  ['addToList'],
      argSets:  { addToList: ['brood'] },
      listName: 'boodschappen',
    },
  },
  {
    name: 'contrast: "ik wil X zien" → SHOW (not add)',
    setup: { boodschappen: ['appels', 'peren'] },
    turn:  'ik wil de boodschappen zien',
    expect: { toolIds: ['showList'], listName: 'boodschappen', hasButtons: true },
  },

  // ── No-translate (boodschappen MUST NOT become shopping) ────────
  {
    name: 'no-translate (boodschappen ≠ shopping)',
    setup: {},
    turn:  'voeg appels en bananen toe aan boodschappen',
    expect: {
      toolIds:  ['addToList', 'addToList'],
      argSets:  { addToList: ['appels', 'bananen'] },
      listName: 'boodschappen',                  // STRICT
    },
  },

  // ── Chitchat — no tool calls expected ──────────────────────────
  { name: 'chitchat (hoi)',                lite: true, setup: {}, turn: 'Hoi',     expect: { toolIds: [] } },
  { name: 'chitchat (goedemorgen)',        setup: {}, turn: 'haha goedemorgen',    expect: { toolIds: [] } },
  { name: 'chitchat (hoe gaat het)',       setup: {}, turn: 'hoe gaat het?',       expect: { toolIds: [] } },
  { name: 'chitchat (lekker weer)',        setup: {}, turn: 'lekker weer vandaag', expect: { toolIds: [] } },

  // ── Typo passthrough (loose — model may correct or preserve) ───
  {
    name: 'typo handled by addToList (loose)',
    setup: {},
    turn:  'voeg bwananen toe aan boodschappen',
    expect: {
      toolIds:  ['addToList'],
      // We don't enforce the item value verbatim — silently
      // correcting "bwananen" → "bananen" is a model choice the
      // user found acceptable.  Strict requirement: addToList
      // was called exactly once, on boodschappen, with NO dups.
      listName: 'boodschappen',
    },
  },

  // ── Multi-turn workflows (where multi-turn is the point) ───────
  {
    name: 'workflow: show → tap → confirm',
    lite: true,
    setup: { boodschappen: ['appels', 'peren', 'kaas'] },
    turn: [
      'toon boodschappen',
      'ik heb appels van boodschappen',          // synthetic tap
    ],
    expect: [
      { toolIds: ['showList'], listName: 'boodschappen', hasButtons: true },
      { toolIds: ['removeFromList'], argSets: { removeFromList: ['appels'] }, listName: 'boodschappen' },
    ],
  },
  {
    name: 'workflow: add → show → remove → show',
    setup: {},
    turn: [
      'voeg melk en brood toe aan boodschappen',
      'wat staat er op boodschappen?',
      'ik heb melk',
      'wat staat er nu op boodschappen?',
    ],
    expect: [
      { toolIds: ['addToList', 'addToList'], argSets: { addToList: ['melk', 'brood'] }, listName: 'boodschappen' },
      { toolIds: ['showList'], listName: 'boodschappen', hasButtons: true },
      { toolIds: ['removeFromList'], argSets: { removeFromList: ['melk'] } },
      { toolIds: ['showList'], listName: 'boodschappen', hasButtons: true },
    ],
  },
];

// ─── Test runner ────────────────────────────────────────────────

function buildLlm(model) {
  return new LlmClient({
    provider: ollamaProvider({
      baseUrl:        process.env.HOUSEHOLD_LLM_BASE_URL,
      model,
      defaultOptions: LLM_OPTIONS,
    }),
  });
}

/**
 * Pre-warm the model so the first scored turn isn't penalised by
 * model load time.  Safe to skip via HOUSEHOLD_SMOKE_NOWARM=1.
 */
async function preWarm(llm) {
  if (process.env.HOUSEHOLD_SMOKE_NOWARM === '1') return;
  try {
    await llm.invoke({
      system:   'Reply with "ok".',
      messages: [{ role: 'user', content: 'ping' }],
      tools:    [],
    });
  } catch { /* swallow — pre-warm is best-effort */ }
}

/**
 * Run a fixture.
 *
 * @param {Fixture} fixture
 * @param {string} model
 */
async function runFixture(fixture, model) {
  const bridge = new InMemoryBridge({ id: 'smoke' });
  const store  = createListStore();
  const llm    = buildLlm(model);

  // Apply setup directly (no LLM).
  if (fixture.setup) {
    for (const [name, items] of Object.entries(fixture.setup)) {
      for (const item of items) store.addItem(name, item);
    }
  }

  /** @type {Array<{id: string, args: object}>} */
  const toolCalls = [];
  const handlers = createToolHandlers(store);
  const recordingHandlers = Object.fromEntries(
    Object.entries(handlers).map(([id, fn]) => [
      id,
      async (args, ctx) => {
        toolCalls.push({ id, args: { ...(args ?? {}) } });
        return fn(args, ctx);
      },
    ]),
  );

  const agent = new ChatAgent({
    bridges:        [bridge],
    llm,
    toolCatalogue:    TOOL_CATALOGUE,
    toolHandlers:   recordingHandlers,
    systemPrompt:   SYSTEM_PROMPT,
    contextBuilder: createContextBuilder(store),
    sessionTtlMs:   60_000,
    historyDepth:   16,
  });
  agent.on('error', () => { /* swallow */ });
  await agent.start();

  // Normalize turn / expect to arrays.
  const turns   = Array.isArray(fixture.turn)   ? fixture.turn   : [fixture.turn];
  const expects = Array.isArray(fixture.expect) ? fixture.expect : [fixture.expect];

  /** @type {Array<{input: string, pass: boolean, reason?: string, toolCalls: any[], elapsed: number}>} */
  const results = [];
  for (let i = 0; i < turns.length; i++) {
    const turn   = turns[i];
    const expect = expects[i] ?? expects[expects.length - 1];

    bridge.clearOutbox();
    toolCalls.length = 0;
    const startedAt = Date.now();
    try {
      await bridge.simulateIncoming({ text: turn });
    } catch (err) {
      results.push({
        input:   turn,
        pass:    false,
        reason:  `threw: ${err?.message ?? err}`,
        toolCalls: [],
        replies: [],
        elapsed: Date.now() - startedAt,
      });
      continue;
    }
    const elapsed = Date.now() - startedAt;
    const replies = bridge.outbox.map((m) => ({ text: m.text, hasButtons: Array.isArray(m.buttons) && m.buttons.length > 0 }));
    const score   = scoreTurn(expect, toolCalls, bridge.outbox);
    results.push({ input: turn, ...score, replies, elapsed });
  }

  await agent.stop();
  const pass = results.filter((r) => r.pass).length;
  return { pass, total: results.length, results };
}

function scoreTurn(expect, toolCalls, outbox) {
  const e = expect ?? {};
  const reasons = [];

  // 1. Tool ids
  if (Array.isArray(e.toolIds)) {
    const expectedCounts = countBy(e.toolIds);
    const actualCounts   = countBy(toolCalls.map((c) => c.id));
    if (!e.allowExtraTools) {
      const allKeys = new Set([...Object.keys(expectedCounts), ...Object.keys(actualCounts)]);
      for (const k of allKeys) {
        const exp = expectedCounts[k] ?? 0;
        const act = actualCounts[k] ?? 0;
        if (exp !== act) {
          reasons.push(`expected ${exp}× ${k}, got ${act}× ${k}`);
        }
      }
    } else {
      for (const [k, exp] of Object.entries(expectedCounts)) {
        const act = actualCounts[k] ?? 0;
        if (act < exp) reasons.push(`expected ≥${exp}× ${k}, got ${act}`);
      }
    }
  }

  // 2. argSets
  if (e.argSets) {
    for (const [toolId, expectedArgs] of Object.entries(e.argSets)) {
      const actualValues = toolCalls
        .filter((c) => c.id === toolId)
        .map((c) => primaryArg(c));
      for (const expected of expectedArgs) {
        const found = actualValues.some((a) => a && a.toLowerCase() === expected.toLowerCase());
        if (!found) reasons.push(`${toolId} missing arg "${expected}" (got: [${actualValues.join(', ') || '—'}])`);
      }
    }
  }

  // 3. listName — every tool call this turn must use it
  if (e.listName) {
    for (const c of toolCalls) {
      if (c.args?.listName && c.args.listName !== e.listName) {
        reasons.push(`${c.id}: listName="${c.args.listName}" but expected "${e.listName}"`);
      }
    }
  }

  // 4. hasButtons
  if (e.hasButtons === true) {
    const anyButtons = outbox.some((m) => Array.isArray(m.buttons) && m.buttons.length > 0);
    if (!anyButtons) reasons.push('expected buttons in reply, none found');
  }

  // 5. replyContains
  if (e.replyContains != null) {
    const fullText = outbox.map((m) => m.text ?? '').join('\n');
    const ok = e.replyContains instanceof RegExp
      ? e.replyContains.test(fullText)
      : fullText.toLowerCase().includes(String(e.replyContains).toLowerCase());
    if (!ok) reasons.push(`reply did not match ${e.replyContains}`);
  }

  return reasons.length === 0
    ? { pass: true, toolCalls: [...toolCalls] }
    : { pass: false, reason: reasons.join('; '), toolCalls: [...toolCalls] };
}

function countBy(arr) {
  const out = {};
  for (const x of arr) out[x] = (out[x] ?? 0) + 1;
  return out;
}

function primaryArg(call) {
  const a = call.args ?? {};
  return a.item ?? a.match ?? a.listName ?? null;
}

// ─── Output formatting ──────────────────────────────────────────

const C = {
  reset: '\x1b[0m', dim: '\x1b[2m',
  red:   '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

function fmtToolCall(c) {
  const a = c.args ?? {};
  const args = Object.entries(a).map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ');
  return `${c.id}(${args})`;
}

function shorten(s, n) {
  s = String(s ?? '');
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

async function runForModel(model, filter, fixtures = FIXTURES) {
  process.stdout.write(`\n${C.cyan}=== ${model} ===${C.reset}\n`);
  const llm = buildLlm(model);
  if (process.env.HOUSEHOLD_SMOKE_NOWARM !== '1') {
    process.stdout.write(`${C.dim}  pre-warming…${C.reset}\n`);
    await preWarm(llm);
  }

  let totalPass = 0, totalTotal = 0;
  for (const fixture of fixtures) {
    if (filter && !fixture.name.toLowerCase().includes(filter.toLowerCase())) continue;
    let r;
    try {
      r = await runFixture(fixture, model);
    } catch (err) {
      process.stdout.write(`  ${C.red}✗ FIXTURE ERRORED [${fixture.name}]: ${err?.message ?? err}${C.reset}\n`);
      continue;
    }
    const turnsTotal = r.total;
    const turnsPass  = r.pass;
    const allPass    = turnsPass === turnsTotal && turnsTotal > 0;
    const mark       = allPass ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
    const counts     = turnsTotal > 1 ? ` ${C.dim}(${turnsPass}/${turnsTotal})${C.reset}` : '';
    process.stdout.write(`  ${mark} ${fixture.name}${counts}\n`);

    for (const t of r.results) {
      if (turnsTotal > 1) {
        const sub = t.pass ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
        process.stdout.write(`      ${sub} ${shorten(t.input, 64)}  ${C.dim}(${(t.elapsed/1000).toFixed(1)}s)${C.reset}\n`);
      } else if (!t.pass) {
        process.stdout.write(`      input: ${shorten(t.input, 80)}  ${C.dim}(${(t.elapsed/1000).toFixed(1)}s)${C.reset}\n`);
      }
      if (!t.pass) {
        process.stdout.write(`      ${C.red}reason:${C.reset} ${t.reason}\n`);
        const calls = (t.toolCalls ?? []).map(fmtToolCall).join(', ');
        process.stdout.write(`      ${C.dim}calls:  ${calls || '(none)'}${C.reset}\n`);
        // Show what the bot replied so the user can see whether the
        // model emitted text-only, JSON-text, or nothing at all.
        const replies = t.replies ?? [];
        if (replies.length === 0) {
          process.stdout.write(`      ${C.dim}reply:  (no bridge reply)${C.reset}\n`);
        } else {
          for (const r of replies) {
            const tag = r.hasButtons ? '[+buttons]' : '';
            const txt = (r.text ?? '').replace(/\n/g, ' ').slice(0, 240);
            process.stdout.write(`      ${C.dim}reply:  ${tag} ${txt}${C.reset}\n`);
          }
        }
      }
    }
    totalPass  += turnsPass;
    totalTotal += turnsTotal;
  }
  return { model, pass: totalPass, total: totalTotal };
}

// ─── Main ────────────────────────────────────────────────────────

const DEFAULT_MODELS = [
  'qwen2.5:7b-instruct',
  'mistral:7b-instruct',
  'bramvanroy/geitje-7b-ultra:Q4_K_M',
];

const LITE_DEFAULT_MODEL = 'qwen2.5:3b-instruct';

async function main() {
  const lite      = process.env.HOUSEHOLD_SMOKE_LITE === '1';
  const modelsEnv = process.env.HOUSEHOLD_LLM_MODELS;
  const models    = modelsEnv
    ? modelsEnv.split(',').map((s) => s.trim()).filter(Boolean)
    : (lite ? [LITE_DEFAULT_MODEL] : DEFAULT_MODELS);
  const filter    = process.env.HOUSEHOLD_SMOKE_FILTER;

  // Lite mode: filter to fixtures explicitly tagged `lite: true`.
  // ~5 fixtures × 1 fast model ≈ 30–60s for a quick first impression.
  const fixturesToRun = lite
    ? FIXTURES.filter((f) => f.lite === true)
    : FIXTURES;
  const totalTurns = fixturesToRun.reduce((a, f) => a + (Array.isArray(f.turn) ? f.turn.length : 1), 0);

  process.stdout.write(`# freetext-smoke — ${lite ? `${C.yellow}LITE${C.reset} ` : ''}atomic fixtures across ${models.length} model(s)\n`);
  process.stdout.write(`# fixtures: ${fixturesToRun.length} (${totalTurns} turns total)${lite ? ' [lite subset]' : ''}\n`);
  if (filter) process.stdout.write(`# filter:   "${filter}"\n`);
  process.stdout.write(`# models:   ${models.join(', ')}\n`);
  process.stdout.write(`# prompt:   ${ACTIVE_PROMPT}\n`);
  if (LLM_OPTIONS) {
    const optStr = Object.entries(LLM_OPTIONS)
      .map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(' ');
    process.stdout.write(`# llm-opts: ${optStr}\n`);
  }
  if (lite) {
    process.stdout.write(`# mode:     LITE — quick first impression.  Skip pre-warm, single fast model.\n`);
    process.stdout.write(`# note:     unset HOUSEHOLD_SMOKE_LITE for the full run.\n`);
  } else {
    process.stdout.write(`# note:     each fixture starts with a fresh agent + pre-populated store, so failures attribute to a single capability.\n`);
  }

  // In lite mode, skip pre-warm to keep total time low.
  if (lite) process.env.HOUSEHOLD_SMOKE_NOWARM = '1';

  const summaries = [];
  for (const model of models) {
    try {
      const summary = await runForModel(model, filter, fixturesToRun);
      summaries.push(summary);
    } catch (err) {
      process.stdout.write(`\n${C.red}=== ${model}: ERRORED — ${err?.message ?? err} ===${C.reset}\n`);
      summaries.push({ model, pass: 0, total: 0, error: String(err?.message ?? err) });
    }
  }

  process.stdout.write(`\n${C.cyan}=== Summary ===${C.reset}\n\n`);
  const colWidth = Math.max(...summaries.map((s) => s.model.length));
  for (const s of summaries) {
    const pct = s.total ? Math.round((s.pass / s.total) * 100) : 0;
    const colour = pct >= 80 ? C.green : pct >= 50 ? C.yellow : C.red;
    const detail = s.error
      ? `${C.red}error: ${s.error}${C.reset}`
      : `${colour}${s.pass}/${s.total} (${pct}%)${C.reset}`;
    process.stdout.write(`  ${s.model.padEnd(colWidth)}   ${detail}\n`);
  }
  process.stdout.write('\n');
}

main().catch((err) => {
  console.error('fatal:', err?.stack ?? err);
  process.exit(1);
});
