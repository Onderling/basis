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
 * A thread is whatever the door calls one: a circle, a Telegram chat, a DM. `remember()` feeds the
 * memory; the door decides what counts as a turn (the runner records what came in and what went out).
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
 * @param {object|null} [a.llm]            an LlmClient; null → basic mode (gate only)
 * @param {Function|null} [a.interpret]    `interpretToCommand`; used only with an llm
 * @param {(ctx:object) => Promise<Array<{id:string,type?:string,text:string}>>} [a.loadItems]  the items
 *        retrieval may draw from; absent → no retrieval
 * @param {object} [a.embedder]            optional; without it retrieval is lexical
 * @param {string} [a.botName='assistant']
 * @param {number} [a.memoryTurns]
 * @param {Function} [a.onUnhandled] @param {Function} [a.onLlmUnavailable] @param {Function} [a.onNoMatch]
 * @param {object} [a.policy]              circle policy; default derives from llm presence
 * @param {{evaluate:Function}} [a.gate]   (tests) a gate override
 */
export function createAssistantEngine({
  catalogue, dispatch, lang = 'nl', llm = null, interpret = null, loadItems = null, embedder = null,
  botName = 'assistant', memoryTurns = ASSISTANT_MEMORY_TURNS, onUnhandled, onLlmUnavailable, onNoMatch, policy, gate: gateIn = null,
} = {}) {
  if (!catalogue) throw new TypeError('createAssistantEngine: catalogue required');
  if (typeof dispatch !== 'function') throw new TypeError('createAssistantEngine: dispatch required');
  const smart = Boolean(llm && typeof interpret === 'function');
  const retrieve = typeof loadItems === 'function'
    ? makeCircleRetriever({ loadItems, ...(embedder ? { embedder } : {}) })
    : undefined;
  const gate = gateIn ?? createTokenGate({ rules: circleGateRules(lang), ...(retrieve ? { retrieve } : {}) });

  /** threadId → the last turns, oldest → newest, as self-describing lines. */
  const memory = new Map();
  const linesFor = (threadId) => memory.get(threadId) ?? [];
  function remember(threadId, who, text) {
    const t = String(text ?? '').trim();
    if (!threadId || !t) return;
    const lines = memory.get(threadId) ?? [];
    lines.push(`${who === 'assistant' ? 'assistant' : 'you'}: ${t}`);
    while (lines.length > memoryTurns) lines.shift();
    memory.set(threadId, lines);
  }

  /** One engine per thread — its `recentTurns` is bound to that thread's memory. */
  const engines = new Map();
  function engineFor(threadId) {
    let e = engines.get(threadId);
    if (e) return e;
    e = createCircleDispatch({
      catalogue,
      policy: policy ?? { llmTool: smart ? 'local' : 'off' },
      llmProviders: smart ? { local: llm } : null,
      interpret: smart ? interpret : async () => null,
      gate,
      botName,
      recentTurns: () => linesFor(threadId),
      dispatch,
      onUnhandled, onLlmUnavailable, onNoMatch,
    });
    engines.set(threadId, e);
    return e;
  }

  return {
    smart,
    remember,
    recentTurns: linesFor,
    /** Run one free-text turn on a thread. The text is tagged for the bot: a private door IS addressed. */
    handle: (threadId, text, ctx = {}) => engineFor(threadId).handle(`@${botName} ${text}`, { id: threadId, ...ctx }),
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
