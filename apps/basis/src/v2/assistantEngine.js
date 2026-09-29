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
 *
 * A thread's lines are taken one turn at a time (its LANE), and lines that come in within a short window are one turn
 * (the COLLECT WINDOW, `assistant.collectMs`): "melk", "brood", "eieren" typed in a second reach the model as one
 * member message, "melk\nbrood\neieren", and come back as three adds. The gate still reads each line on its own (see
 * `createCircleDispatch`). A line for the circle, not the bot, is never gathered or held back by the window, but it
 * does keep its place in the lane. A door that handles some lines itself (the answer to its pending ask, a
 * confirmation, a command) names them with `claim`: the check runs when the line's turn comes, so a line typed while
 * the turn that asks was running is the answer. `around` wraps every turn with the door's own bookkeeping.
 *
 * WHICH DOOR COLLECTS: a chat app (the box's Telegram door) keeps the default window — there, quick lines arrive as
 * separate messages and belong together. The circle composers (web, mobile) pass `collectMs: 0`: a person types one
 * line on purpose there, and a wait on every bot reply would read as a slow app. Their lane still serialises, and
 * lines that queue up while a turn runs are still one turn.
 */
import { createCircleDispatch, addressesBot, stripBotTag } from './circleDispatch.js';
import { createThreadLanes, COLLECT_MS } from './assistantLane.js';
import { createTokenGate } from './tokenGate.js';
import { circleGateRules } from './circleGate.js';
import { makeCircleRetriever } from './circleRetriever.js';
import { DEFAULT_INTERPRET_SYSTEM } from './interpretCommand.js';
import { detectLang } from './assistantLanguage.js';
import { chatHintFor } from './chatHints.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

export const ASSISTANT_MEMORY_TURNS = 6;
/** How much the model may vary: low and fixed, so the same line picks the same tool. No `tool_choice`. */
export const ASSISTANT_TEMPERATURE = param({ key: 'assistant.temperature', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 0.2 });
const DEFAULT_THREAD = '__default__';

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
 * @param {{remember:(threadId:string, who:string, text:string) => void, recent:(threadId:string) => string[]}} [a.memory]
 *        where `remember()` keeps turns and what a thread reads back (a door's durable threads); absent → this process
 * @param {(threadId:string) => object} [a.catalogueFor]  a door that offers each person their own tools (a household
 *        bot: a member's or an admin's): the catalogue for a thread; absent → the one catalogue for every thread
 * @param {Array<object>} [a.gateRules]  the deterministic gate's rules (a household bot's speak its lists); absent → the
 *        circle rules
 * @param {string[]} [a.promptLines]  what a door's template tells the model about its household (added to the stable
 *        instruction: the same every turn, so it stays above the turn marker)
 * @param {(threadId:string) => string|null} [a.threadLang]  the language a person fixed their thread to (`/taal`);
 *        it replaces the detected one in the turn's hint
 * @param {string} [a.botName='assistant']
 * @param {number} [a.memoryTurns]
 * @param {Function} [a.postToCircle]      the chat sink for a line that is not for the bot (circle doors)
 * @param {Function} [a.onUnhandled] @param {Function} [a.onLlmUnavailable] @param {Function} [a.onNoMatch]
 * @param {boolean} [a.dispatchSlash]      forwarded to the engine (a shell that routes slash itself passes false)
 * @param {{evaluate:Function}} [a.gate]   a gate override (tests)
 * @param {number} [a.collectMs]           the collect window (default `assistant.collectMs`)
 * @param {(text:string, ctx:object) => (null|(() => Promise<any>))} [a.claim]  a line the door handles itself: return
 *        the handling (it must not act yet — it runs when the line's turn comes), or null to leave the line to the engine
 * @param {(ctx: object) => any} [a.onSlow]  the model route is slow and retrying (the door tells the person to wait)
 * @param {(cmd: object) => object[]} [a.expand]  a door's rewrite of a chosen op into the ops it stands for (see `createCircleDispatch`)
 * @param {(threadId: string) => string[]} [a.threadHints]  a thread's own lines for the model (its role's)
 * @param {(cmd:{opId:string,args:object}, ctx:object) => Promise<any>} [a.peek]  run an op without showing it (a read the
 *        model picks is handed back to it once, so the turn acts — see `createCircleDispatch`)
 * @param {(turn:{threadId:string, lines:string[], ctx:object, own:boolean}, run:() => Promise<any>) => Promise<any>} [a.around]
 *        the door's bookkeeping around every turn (its record of the turn, what it remembers afterwards)
 */
export function createAssistantEngine({
  catalogue, dispatch, lang = 'nl', llm = null, llmProviders = null, policy, userDefault, interpret = null,
  loadItems = null, embedder = null, embed = null, vectorStore, minScore, retrieverScope,
  recentTurns: recentTurnsIn = null, memory: memoryIn = null, threadLang = null, promptLines = null, catalogueFor = null, gateRules = null, botName = 'assistant', memoryTurns = ASSISTANT_MEMORY_TURNS,
  postToCircle, onUnhandled, onLlmUnavailable, onNoMatch, dispatchSlash, gate: gateIn = null,
  collectMs = COLLECT_MS, claim = null, around = null, peek = null, threadHints = null, expand = null, onSlow = null,
} = {}) {
  if (!catalogue) throw new TypeError('createAssistantEngine: catalogue required');
  if (typeof dispatch !== 'function') throw new TypeError('createAssistantEngine: dispatch required');
  const providers = llmProviders ?? (llm ? { local: llm } : null);
  const smart = Boolean(providers && typeof interpret === 'function');
  // The interpreter speaks the member's language and knows the local phrasings for "add" — seen live:
  // an English greeting answered a Dutch "Maii", and "kun je … toevoegen?" was read as "show the list".
  // The stable instruction (the rules and this language's phrasings) and this turn's hints (the language line), kept
  // apart so the interpreter puts the stable part first and the hints below its turn marker.
  const extra = Array.isArray(promptLines) ? promptLines.filter((l) => typeof l === 'string' && l.trim()) : [];
  const system = extra.length ? `${interpretSystemFor(lang)}\n${extra.join('\n')}` : interpretSystemFor(lang);
  const interpretIn = typeof interpret === 'function'
    ? (text, o = {}) => interpret(text, { ...o, system: o.system ?? system, hints: o.hints ?? interpretHintsFor(text) })
    : null;
  // A thread fixed to a language (`/taal`) says so in its hint instead of what the line looks like. The tools are
  // described in the thread's language first (its own, what the line is written in, else the door's), and the model
  // is called at the pinned temperature.
  const interpretFor = (threadId) => (text, o = {}) => {
    const fixed = typeof threadLang === 'function' && threadId ? threadLang(threadId) : null;
    const toolLang = fixed ?? detectLang(text) ?? String(lang).slice(0, 2);
    // The thread's own hints (a member told which tools are the admin's), below the language line.
    const own = typeof threadHints === 'function' && threadId ? (threadHints(threadId) ?? []) : [];
    const langHints = fixed ? [replyInHint(fixed)] : interpretHintsFor(text);
    return interpretIn(text, {
      ...o,
      ...(fixed || own.length ? { hints: o.hints ?? [...langHints, ...own] } : {}),
      options: o.options ?? { temperature: ASSISTANT_TEMPERATURE },
      toolLang: o.toolLang ?? toolLang,
      hintFor: o.hintFor ?? chatHintFor,
    });
  };
  const retrieve = typeof loadItems === 'function'
    ? makeCircleRetriever({
      loadItems,
      ...(embedder ? { embedder } : {}), ...(typeof embed === 'function' ? { embed } : {}),
      ...(vectorStore ? { vectorStore } : {}), ...(minScore !== undefined ? { minScore } : {}),
      ...(retrieverScope ? { scope: retrieverScope } : {}),
    })
    : undefined;
  const gate = gateIn ?? createTokenGate({ rules: Array.isArray(gateRules) ? gateRules : circleGateRules(lang), ...(retrieve ? { retrieve } : {}) });

  // Three voices: you · assistant (the model's own words) · system (an op's result). Keeping the op results apart
  // stops the model imitating "✓ added …" instead of calling the tool.
  const memory = memoryIn && typeof memoryIn.remember === 'function' && typeof memoryIn.recent === 'function'
    ? memoryIn
    : processMemory(memoryTurns);
  const linesFor = (threadId) => memory.recent(threadId) ?? [];
  const remember = (threadId, who, text) => memory.remember(threadId, who, text);

  /** One engine per thread — its `recentTurns` is bound to that thread (the door's getter, or the memory). */
  const engines = new Map();
  function engineFor(threadId) {
    const key = threadId ?? DEFAULT_THREAD;
    let e = engines.get(key);
    if (e) return e;
    e = createCircleDispatch({
      catalogue: typeof catalogueFor === 'function' ? () => catalogueFor(threadId) : catalogue,
      policy: policy ?? { llmTool: smart ? 'local' : 'off' },
      ...(userDefault !== undefined ? { userDefault } : {}),
      llmProviders: smart ? providers : null,
      interpret: smart ? interpretFor(threadId) : async () => null,
      gate,
      botName,
      recentTurns: typeof recentTurnsIn === 'function' ? recentTurnsIn : () => linesFor(threadId),
      dispatch,
      ...(typeof postToCircle === 'function' ? { postToCircle } : {}),
      ...(dispatchSlash !== undefined ? { dispatchSlash } : {}),
      onUnhandled, onLlmUnavailable, onNoMatch,
      ...(typeof peek === 'function' ? { peek } : {}),
      ...(typeof expand === 'function' ? { expand } : {}),
      ...(typeof onSlow === 'function' ? { onSlow } : {}),
    });
    engines.set(key, e);
    return e;
  }

  const memoryCount = (threadId) => (typeof recentTurnsIn === 'function' ? (recentTurnsIn() || []) : linesFor(threadId)).length;

  // An entry is one line: `text` as the door gave it, `solo` what the dispatcher gets when the line is a turn on its
  // own (unchanged from before the lane), `line` its words without the bot's tag (what a gathered turn joins),
  // `collect` whether it may be gathered with other lines (a line for the bot, not one for the circle).
  const lanes = createThreadLanes({
    collectMs,
    prepare: (entry) => {
      const own = typeof claim === 'function' ? claim(entry.text, entry.ctx) : null;
      if (typeof own === 'function') return { own };
      return { collect: entry.collect && !entry.line.startsWith('/') };
    },
    runTurn: ({ entries }) => {
      const [first] = entries;
      const threadId = first.threadId;
      // Several lines: one member message, the lines kept as lines, addressed once.
      const text = entries.length === 1 ? first.solo : `@${botName} ${entries.map((e) => e.line).join('\n')}`;
      // How much memory there is NOW, when the turn runs — the turns before it in the lane have been remembered.
      return engineFor(threadId).handle(text, { ...first.ctx, memoryTurns: memoryCount(threadId) });
    },
    ...(typeof around === 'function'
      ? { around: ({ entries, own }, run) => around({ threadId: entries[0].threadId, lines: entries.map((e) => e.text), ctx: entries[0].ctx, own }, run) }
      : {}),
  });

  return {
    smart,
    remember,
    recentTurns: linesFor,
    /** A circle door: the raw line; the engine decides whether the bot was addressed (`ctx.id` = the thread). */
    handle: (text, ctx = {}) => {
      const raw = String(text ?? '').trim();
      // A line for the circle, not the bot, is never gathered and never waits for a window — but it does take its
      // place in the lane: typed while a bot turn runs, it may be the answer to what that turn asks (`claim`).
      const forBot = raw.startsWith('/') || addressesBot(raw, botName);
      const line = forBot && !raw.startsWith('/') ? stripBotTag(raw, botName) : raw;
      return lanes.push(ctx?.id ?? DEFAULT_THREAD, { threadId: ctx?.id, text, solo: text, line, collect: forBot, ctx });
    },
    /** A private door (Telegram, a DM): every line is for the bot — tagged here so the engine treats it so. */
    ask: (threadId, text, ctx = {}) => {
      const line = String(text ?? '').trim();
      return lanes.push(threadId ?? DEFAULT_THREAD, { threadId, text, solo: `@${botName} ${text}`, line, collect: true, ctx: { id: threadId, ...ctx } });
    },
    /** Resolves when the thread's lane (every lane, without a thread) has nothing queued or running. */
    idle: (threadId) => lanes.idle(threadId === undefined ? undefined : (threadId ?? DEFAULT_THREAD)),
    /** Retrieval on its own (tests, diagnostics). */
    retrieve: retrieve ? (text, ctx = {}) => retrieve(text, ctx) : null,
  };
}

/**
 * Memory that lasts as long as the process: threadId → the last turns, oldest → newest, as self-describing lines.
 * @param {number} memoryTurns
 */
function processMemory(memoryTurns) {
  const lines = new Map();
  return {
    remember(threadId, who, text) {
      const t = String(text ?? '').trim();
      if (!threadId || !t) return;
      const own = lines.get(threadId) ?? [];
      own.push(`${who === 'assistant' ? 'assistant' : who === 'system' ? 'system' : 'you'}: ${t}`);
      while (own.length > memoryTurns) own.shift();
      lines.set(threadId, own);
    },
    recent: (threadId) => lines.get(threadId) ?? [],
  };
}

/**
 * The line a door speaks when the assistant did not act on a turn (or did not finish it): the model's own words when
 * it spoke, "en verder?" when the turn was cut short (the per-turn cap, or a call the output cut off), else the
 * door's own fallback. One answer for every door, so a cut turn is asked about the same way everywhere.
 * @param {{reply?: string, partial?: boolean}|undefined} opts  what `onNoMatch` received
 * @param {(key: string) => string} t
 * @param {string} fallbackKey  the door's "could not make that into an action" key
 */
export function assistantReplyText(opts, t, fallbackKey) {
  if (opts && typeof opts.reply === 'string' && opts.reply) return opts.reply;
  if (opts && opts.partial === true) return t('circle.bot.more');
  // a reply that claimed a result twice, with nothing done: said plainly instead
  if (opts && opts.notDone === true) return t('circle.bot.not_done');
  return t(fallbackKey);
}

const LANG_NAMES = { nl: 'Dutch', en: 'English', de: 'German', fr: 'French' };
/**
 * The interpreter's STABLE system prompt for a door: the shared instruction, the reply-language rule (the member's
 * language; the door's when that cannot be told), and the door language's add-phrasings.
 */
export function interpretSystemFor(lang = 'nl') {
  const name = LANG_NAMES[String(lang).slice(0, 2)] ?? 'the member\'s language';
  const add = lang === 'nl'
    ? 'In Dutch, "zet … op", "voeg … toe", "doe … erbij", "kun je … toevoegen", "… moet nog gehaald worden" all mean ADD the named items to the list — call the add tool, one call per item when several are named. When you name a list to the member, use the Dutch names: boodschappen (shopping), klusjes (errand), reparaties (repair), agenda (schedule) — never the English enum words.'
    : 'Phrasings like "put … on", "add …", "we need …", "can you add …" all mean ADD the named items — call the add tool, one call per item when several are named.';
  // Seen live: an earlier request that got no action was done again, beside the new one.
  const newest = 'Earlier turns are context: act on the member\'s NEWEST message only, never redo or finish a request from an earlier turn.';
  return `${DEFAULT_INTERPRET_SYSTEM}\nReply in the member's language; when you cannot tell, in ${name}.\n${add}\n${newest}`;
}

/** The hint for a thread the person fixed to a language. LLM-facing. */
export function replyInHint(lang) {
  return `Reply in ${LANG_NAMES[String(lang).slice(0, 2)] ?? lang}, whatever language the member writes in.`;
}

/** This turn's hints, below the prompt's turn marker: what the member's line was written in, when that is clear. */
export function interpretHintsFor(text) {
  const wrote = detectLang(text);
  return wrote ? [`The member wrote in: ${wrote}.`] : [];
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
