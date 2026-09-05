/**
 * assistantEngine — ONE composition of the assistant, for every door.
 *
 * The circle composer (web, mobile) and the Telegram shell all drive `createCircleDispatch`, but each
 * used to compose its surroundings by hand: which gate rules, whether the last turns reach the model,
 * whether the model sees the items already there. This module is that composition, once:
 *
 *   · the deterministic gate (`circleGateRules` for the language) — "add X" / "done X" never hit a model;
 *   · retrieval — a lexical (or, with an embedder, semantic) search over the items `loadItems` returns,
 *     attached to the prompt as context, so "is there milk on the list?" is answered from the list;
 *   · memory — the last N turns of THIS thread, as "you: …" / "assistant: …" lines, re-sent with every
 *     call, because the model remembers nothing between calls (Privatemode is stateless by design);
 *   · the interpreter and the model, when a route is configured — else the gate alone (basic mode).
 *
 * A thread is whatever the door calls one: a circle, a Telegram chat, a DM. Memory comes either from
 * `remember()` (a door with no stream of its own — Telegram) or from a `recentTurns` getter the door
 * supplies (the circle composers read the rows already on screen). A private door calls `ask()` — its
 * lines are addressed by nature; a circle calls `handle()` with the raw line, and the engine decides
 * whether the bot was addressed at all (a group line that names nobody is chat, and fans out).
 */
import { createCircleDispatch } from './circleDispatch.js';
import { createTokenGate } from './tokenGate.js';
import { circleGateRules } from './circleGate.js';
import { makeCircleRetriever } from './circleRetriever.js';

export const ASSISTANT_MEMORY_TURNS = 6;

/**
 * @param {object} a
 * @param {object|(()=>object)} a.catalogue
 * @param {(input:string|{opId:string,args:object,appOrigin?:string}, ctx:object) => any} a.dispatch
 * @param {string} [a.lang='nl']
 * @param {object|null} [a.llm]            ONE LlmClient (a single-route door); null → basic mode (gate only)
 * @param {{local?:object,cloud?:object}|null} [a.llmProviders]  the circle composers' two-route form (wins over `llm`)
 * @param {object|(()=>object)|((ctx)=>object)} [a.policy]  the circle policy (`llmTool`, `apps`); static or a getter
 * @param {object|(()=>object)} [a.userDefault]  the member's personal default (when the policy says 'user')
 * @param {Function|null} [a.interpret]    `interpretToCommand`; used only when a route resolves
 * @param {(ctx:object) => Promise<Array<{id:string,type?:string,text:string}>>} [a.loadItems]  the items
 *        retrieval may draw from; absent → no retrieval
 * @param {object|Function} [a.embedder]   optional (an embedder or a per-turn resolver); without it retrieval is lexical
 * @param {Function} [a.embed]             the older bare `embed(texts)` form
 * @param {object} [a.vectorStore] @param {number} [a.minScore] @param {string} [a.retrieverScope]
 * @param {() => string[]} [a.recentTurns] the door's own memory getter (rows on screen); absent → `remember()` memory
 * @param {string} [a.botName='assistant']
 * @param {number} [a.memoryTurns]
 * @param {Function} [a.postToCircle]      the chat sink for a line that is not for the bot (circle doors)
 * @param {Function} [a.onUnhandled] @param {Function} [a.onLlmUnavailable] @param {Function} [a.onNoMatch]
 * @param {boolean} [a.dispatchSlash]      forwarded to the engine (a shell that routes slash itself passes false)
 * @param {{evaluate:Function}} [a.gate]   a gate override (tests)
 */
export function createAssistantEngine({
  catalogue, dispatch, lang = 'nl', llm = null, llmProviders = null, policy, userDefault, interpret = null,
  loadItems = null, embedder = null, embed = null, vectorStore, minScore, retrieverScope,
  recentTurns: recentTurnsIn = null, botName = 'assistant', memoryTurns = ASSISTANT_MEMORY_TURNS,
  postToCircle, onUnhandled, onLlmUnavailable, onNoMatch, dispatchSlash, gate: gateIn = null,
} = {}) {
  if (!catalogue) throw new TypeError('createAssistantEngine: catalogue required');
  if (typeof dispatch !== 'function') throw new TypeError('createAssistantEngine: dispatch required');
  const providers = llmProviders ?? (llm ? { local: llm } : null);
  const smart = Boolean(providers && typeof interpret === 'function');
  const retrieve = typeof loadItems === 'function'
    ? makeCircleRetriever({
      loadItems,
      ...(embedder ? { embedder } : {}), ...(typeof embed === 'function' ? { embed } : {}),
      ...(vectorStore ? { vectorStore } : {}), ...(minScore !== undefined ? { minScore } : {}),
      ...(retrieverScope ? { scope: retrieverScope } : {}),
    })
    : undefined;
  const gate = gateIn ?? createTokenGate({ rules: circleGateRules(lang), ...(retrieve ? { retrieve } : {}) });

  /** threadId → the last turns, oldest → newest, as self-describing lines. */
  const memory = new Map();
  const linesFor = (threadId) => memory.get(threadId) ?? [];
  function remember(threadId, who, text) {
    const t = String(text ?? '').trim();
    if (!threadId || !t) return;
    const lines = memory.get(threadId) ?? [];
    // Three voices: you · assistant (the model's own words) · system (an op's result). Keeping the
    // op results apart stops the model imitating "✓ added …" instead of calling the tool.
    lines.push(`${who === 'assistant' ? 'assistant' : who === 'system' ? 'system' : 'you'}: ${t}`);
    while (lines.length > memoryTurns) lines.shift();
    memory.set(threadId, lines);
  }

  /** One engine per thread — its `recentTurns` is bound to that thread (the door's getter, or the memory). */
  const engines = new Map();
  function engineFor(threadId) {
    const key = threadId ?? '__default__';
    let e = engines.get(key);
    if (e) return e;
    e = createCircleDispatch({
      catalogue,
      policy: policy ?? { llmTool: smart ? 'local' : 'off' },
      ...(userDefault !== undefined ? { userDefault } : {}),
      llmProviders: smart ? providers : null,
      interpret: smart ? interpret : async () => null,
      gate,
      botName,
      recentTurns: typeof recentTurnsIn === 'function' ? recentTurnsIn : () => linesFor(threadId),
      dispatch,
      ...(typeof postToCircle === 'function' ? { postToCircle } : {}),
      ...(dispatchSlash !== undefined ? { dispatchSlash } : {}),
      onUnhandled, onLlmUnavailable, onNoMatch,
    });
    engines.set(key, e);
    return e;
  }

  return {
    smart,
    remember,
    recentTurns: linesFor,
    /** A circle door: the raw line; the engine decides whether the bot was addressed (`ctx.id` = the thread). */
    handle: (text, ctx = {}) => engineFor(ctx?.id).handle(text, ctx),
    /** A private door (Telegram, a DM): every line is for the bot — tagged here so the engine treats it so. */
    ask: (threadId, text, ctx = {}) => engineFor(threadId).handle(`@${botName} ${text}`, { id: threadId, ...ctx }),
    /** Retrieval on its own (tests, diagnostics). */
    retrieve: retrieve ? (text, ctx = {}) => retrieve(text, ctx) : null,
  };
}

/**
 * The items a headless node's assistant may draw on: every open household list item. Shaped for the
 * retriever (`{id, type, text}`); a shell with a circle uses `loadCircleItems` instead.
 * @param {{ callSkill: Function }} a
 */
export function loadAssistantItems({ callSkill }) {
  return async () => {
    try {
      const r = await callSkill('household', 'listOpen', {});
      const items = Array.isArray(r?.items) ? r.items : [];
      return items.map((it) => ({ id: String(it.id ?? ''), type: it.type ?? 'item', text: String(it.text ?? it.label ?? '') })).filter((it) => it.text);
    } catch { return []; }
  };
}
