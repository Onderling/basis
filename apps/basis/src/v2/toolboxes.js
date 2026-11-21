/**
 * toolboxes — a circle's toolboxes on its box, and the four ops over them (ledger L1035).
 *
 * A TOOLBOX is a program that offers TOOLS (one callable function each) and keeps nothing of the circle. The admin
 * adds one by its name, its address and the command words that reach its tools; a member uses a tool. Where things
 * live (Fable, 2026-11-18):
 *   - the KEY comes from the box's operator config (an env value or a key file per toolbox, named by the toolbox's
 *     name), read through `keyOf(name)`; it never passes through a chat, and it never appears in a reply, a refusal,
 *     a log line, the own record or `listTools` (it goes in the request's header only);
 *   - the RECORD (address, words, the tools its card names) lives in the box's vault (`store`), never in the circle's
 *     store;
 *   - a toolbox not added, a tool it does not offer, or a toolbox whose key is gone is refused BEFORE any call leaves.
 * What leaves on a call: the tool's id and its input (the words of the question), nothing about the person or circle.
 * The wire is `toolboxClient.js`. Pure composition: the store, the key reader and `fetch` are handed in.
 */
import { readToolboxCard, callTool, readItemList, fetchThumbs } from './toolboxClient.js';
import { firstPartyFirstWords } from '@onderling/app-manifest';
import { GATE_WORDS } from './gateWords.js';
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

const ON_KEY = 'tools.on';
const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const WORD = /^[a-zà-ÿ][a-zà-ÿ0-9-]{0,23}$/;
/** An op of the household's door as a placed file names it: `app.op`. */
const OP_ID = /^[a-z][a-zA-Z0-9-]{0,31}\.[a-zA-Z][a-zA-Z0-9-]{0,63}$/;

/**
 * May a toolbox's page live at this address: https, or plain http on THIS device's loopback (`localhost` or
 * `127.0.0.1`, exactly; a port and a path are fine; no userinfo), so a page served by a local web server on the
 * same device pairs through the same link and ticket. Plain http on any other host is refused; `[::1]` is not admitted.
 */
function pageAddressOk(s) {
  if (/^https:\/\/[^\s/]+/.test(s)) return true;
  if (/\s/.test(s)) return false;
  let u; try { u = new URL(s); } catch { return false; }
  return u.protocol === 'http:' && !u.username && !u.password && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
}

/** A placed file as the operator wrote it, or null when it is not one (a bad name, address or words). */
function readPlaced(p) {
  const name = String(p?.name ?? '').trim();
  if (!NAME.test(name) || !/^https?:\/\/[^\s/]+/.test(String(p?.url ?? ''))) return null;
  const words = (Array.isArray(p?.words) ? p.words : [])
    .filter((w) => w && WORD.test(String(w.word ?? '').toLowerCase()) && typeof w.tool === 'string' && w.tool)
    .map((w) => ({
      word: String(w.word).toLowerCase(), tool: w.tool, ...(typeof w.field === 'string' && w.field ? { field: w.field } : {}),
      // the phrases that fill a tool parameter ('bij AH' → stores: ['ah']), taken off the line by the gate rule
      ...(() => { const s = readSlots(w.slots, typeof w.field === 'string' && w.field ? w.field : 'query'); return s.length ? { slots: s } : {}; })(),
      // what the word does, in a person's words per language (the operator's: 'zoekt producten'), for /help and the welcome
      ...(w.says && typeof w.says === 'object' ? { says: Object.fromEntries(Object.entries(w.says).filter(([, v]) => typeof v === 'string' && v.trim())) } : {}),
    }));
  // A TOOLBOX'S PAGE (L1113): the address where the operator placed its page (`page`, https or this device's loopback), and the ops of the
  // household's door that page may use beside `tools.useTool` for this toolbox (`ops`, `app.op`, the OPERATOR's words:
  // never read from the toolbox's own card). A page's grant is useTool + these, cut to the person's own role column.
  const ops = [...new Set((Array.isArray(p?.ops) ? p.ops : []).map((o) => String(o ?? '').trim()).filter((o) => OP_ID.test(o) && o !== 'tools.useTool'))];
  const page = pageAddressOk(String(p?.page ?? '')) ? String(p.page) : null;
  return { name, url: String(p.url), words, ...(ops.length ? { ops } : {}), ...(page ? { page } : {}) };
}

/**
 * @param {object} a
 * @param {{get: (k: string) => Promise<string|null>, set: (k: string, v: string) => Promise<void>}} a.store   the box's vault: which are ON, and the card read at the yes
 * @param {() => Promise<object[]>} a.placedOf   the operator's placed toolboxes (one file each: name, address, words)
 * @param {(name: string) => Promise<string|null>} a.keyOf   the operator's key for a toolbox, or null
 * @param {Function} [a.fetch]
 * @param {(...a: unknown[]) => void} [a.log]   codes only
 */
/** What the admin's yes covered: the placed address and words (and a page's address and ops), as one comparable string (a change means a new yes). */
const shownOf = (p) => JSON.stringify({ url: p.url, words: p.words, ...(p.ops ? { ops: p.ops } : {}), ...(p.page ? { page: p.page } : {}) });
/** The origin of a URL, or null. */
const originOf = (u) => { try { return new URL(u).origin; } catch { return null; } };

export function makeToolboxOps({ store, placedOf = async () => [], keyOf, fetch = globalThis.fetch, log = () => {}, takenWords = () => new Set() } = {}) {
  const readOn = async () => { try { const v = JSON.parse((await store.get(ON_KEY)) ?? '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
  const placed = async () => { try { return (await placedOf() ?? []).map(readPlaced).filter(Boolean); } catch { return []; } };
  const keyFor = async (name) => { try { const k = await keyOf(name); return typeof k === 'string' && k.trim() ? k.trim() : null; } catch { return null; } };
  // the words of the toolboxes that are ON, held in memory for the deterministic gate (a rule answers synchronously)
  let words = [];
  const remember = async (onMap) => {
    const ps = await placed();
    // only a toolbox whose placed record is still what the admin's yes was shown (a changed one is off until a new yes)
    words = ps.filter((p) => onMap[p.name]?.shown === shownOf(p)).flatMap((p) => p.words.map((w) => ({ ...w, toolbox: p.name, title: onMap[p.name].title ?? p.name })));
  };
  const writeOn = async (onMap) => { await store.set(ON_KEY, JSON.stringify(onMap)); await remember(onMap); };

  return {
    /** Read once at start, so the gate knows the words of what is on before the first switch of this run. */
    async load() { await remember(await readOn()); },
    /** The words that reach a tool now (ON toolboxes only): `{word, tool, field?, toolbox, title}`. No key, no address. */
    wordsNow: () => words,
    /**
     * A toolbox's page, for the screen door (L1113): `{page, ops}` of a toolbox that is ON now and has a placed page,
     * else null. `ops` are the operator's; the door cuts them to the person's role column.
     */
    pageOf: async (name) => {
      const n = String(name ?? '').trim(); const live = (await readOn())[n]; const p = (await placed()).find((x) => x.name === n);
      if (!live || !p || live.shown !== shownOf(p) || !p.page) return null;
      return { page: p.page, ops: p.ops ?? [] };
    },
    /** Is this toolbox on now (the egress gate asks before a call leaves)? */
    isOn: async (name) => {
      const n = String(name ?? '').trim(); const live = (await readOn())[n]; const p = (await placed()).find((x) => x.name === n);
      return Boolean(live && p && live.shown === shownOf(p));
    },

    /**
     * Switch on a toolbox the operator placed. Without `confirm`: the card to say yes to (its name, address, words and
     * what it receives), nothing switched. With `confirm` (the admin's yes, in the private chat): switched on.
     */
    async addToolbox({ name, confirm = false } = {}) {
      const n = String(name ?? '').trim();
      const p = (await placed()).find((x) => x.name === n);
      if (!p) return { ok: false, code: 'toolbox-not-placed', name: n };
      if (!(await keyFor(n))) { log('tools', 'refused', { check: 'switch-on', reason: 'toolbox-no-key' }); return { ok: false, code: 'toolbox-no-key', name: n }; }
      const card = await readToolboxCard(p.url, { fetch });
      if (!card.ok) { log('tools', 'refused', { check: 'card', reason: card.code }); return { ok: false, code: card.code, name: n }; }
      // the card's endpoint must be the PLACED address's origin: the key and every question go only where the admin saw
      if (!card.endpoint || originOf(card.endpoint) !== originOf(p.url)) { log('tools', 'refused', { check: 'card', reason: 'toolbox-no-endpoint' }); return { ok: false, code: 'toolbox-no-endpoint', name: n }; }
      const offered = new Set(card.tools.map((t) => t.id));
      const missing = p.words.find((w) => !offered.has(w.tool));
      if (missing) return { ok: false, code: 'tool-not-offered', name: n, tool: missing.tool };
      // a word a command or a gate word of this door already uses is not the toolbox's to take
      let taken = new Set();
      try { taken = new Set([...(takenWords() ?? [])].map((w) => String(w).toLowerCase())); } catch { /* none known */ }
      const clash = p.words.find((w) => taken.has(w.word));
      if (clash) return { ok: false, code: 'toolbox-word-taken', name: n, word: clash.word };
      // what it receives, as codes the door words: the words of a question always; a list's references when a word's
      // tool is one that prices a list (a `keys` field, Fable's section 7)
      const receives = ['question', ...(p.words.some((w) => w.field === 'keys') ? ['list-refs'] : [])];
      if (!confirm) return { ok: true, pending: true, name: n, title: card.name || n, url: p.url, words: p.words, receives };
      const onMap = await readOn();
      onMap[n] = { title: card.name || n, endpoint: card.endpoint, tools: card.tools.map((t) => ({ id: t.id, name: t.name })), shown: shownOf(p) };
      await writeOn(onMap);
      return { ok: true, on: true, name: n, title: onMap[n].title };
    },

    /** Switch a toolbox off (the admin): its words reach nothing; the operator's file stays. */
    async removeToolbox({ name } = {}) {
      const n = String(name ?? '').trim();
      const onMap = await readOn();
      if (!onMap[n]) return { ok: false, code: 'toolbox-off', name: n };
      delete onMap[n];
      await writeOn(onMap);
      return { ok: true, on: false, name: n };
    },

    /** The toolboxes: those ON (a member's view), or every placed one with its on/off (`all`, the admin's). Never a key. */
    async listTools({ all = false } = {}) {
      const onMap = await readOn();
      const rows = (await placed()).map((p) => {
        const live = onMap[p.name]; const same = live?.shown === shownOf(p);
        return { name: p.name, title: live?.title ?? p.name, on: Boolean(live) && same, ...(live && !same ? { changed: true } : {}), words: p.words };
      });
      return { ok: true, toolboxes: all ? rows : rows.filter((r) => r.on) };
    },

    /**
     * A member uses a tool of an ON toolbox. Refused before anything leaves when the toolbox is off or not placed, the
     * tool is not one its card offered, or its key is not on the box. A list of things comes back as choices (`items`).
     * `pictures`: the asking door shows pictures (the box then fetches them); false for a words door. `forScreen`: the
     * caller is a connected screen (a toolbox's page), which gets the toolbox's own `output` beside `items`.
     */
    async useTool({ toolbox, tool, input } = {}, { pictures = true, forScreen = false } = {}) {
      const n = String(toolbox ?? '').trim();
      const live = (await readOn())[n];
      const placedNow = (await placed()).find((p) => p.name === n);
      // off, not placed, or placed differently than the admin's yes was shown: off until a new yes
      if (!live || !placedNow || live.shown !== shownOf(placedNow)) return { ok: false, code: 'toolbox-off', name: n };
      if (!live.tools?.some((t) => t.id === tool)) return { ok: false, code: 'tool-not-offered', name: n, tool };
      const key = await keyFor(n);
      if (!key) { log('tools', 'refused', { check: 'use', reason: 'toolbox-no-key' }); return { ok: false, code: 'toolbox-no-key', name: n }; }
      const r = await callTool({ endpoint: live.endpoint, key, tool, input: input && typeof input === 'object' ? input : {}, fetch });
      if (!r.ok) { log('tools', 'refused', { check: 'call', reason: r.code, ...(r.toolCode ? { toolCode: r.toolCode } : {}) }); return { ...r, name: n }; }
      const list = readItemList(r.output, { source: n });
      if (!list.ok) return { ok: true, name: n, title: live.title, tool, output: r.output };
      // the pictures, fetched here by the box from the toolbox's own host and handed on as bytes; no door ever fetches one.
      // Only for a door that shows pictures (`pictures`): a words door gets none, so no bytes ride the relay or the keeper
      const items = pictures ? await fetchThumbs(list.items, { endpoint: live.endpoint, key, fetch }) : list.items.map(({ image, ...x }) => x);
      // `output`: the toolbox's own answer, unchanged, ONLY for a screen (a toolbox's page builds on it); a chat door gets
      // `items` alone (half the bytes, and none of the shops' image addresses the rows dropped)
      return { ok: true, name: n, title: live.title, tool, items, ...(forScreen ? { output: r.output } : {}) };
    },
  };
}

const PARAM = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/;

/**
 * A word's SLOTS as the operator placed them (`slots: [{param, list?, values: {value: [phrases]}}]`): the phrases that
 * mean a value of a tool parameter ('bij albert heijn' → stores: ah). Cleaned: phrases lower case, spaces folded, at most
 * 40 characters, 50 per value, 50 values and 5 slots; a slot without a param, with the word's own field as its param, or
 * without any phrase is dropped. The toolbox's own data: Basis knows no shop.
 */
function readSlots(slots, field) {
  const out = [];
  for (const s of (Array.isArray(slots) ? slots : []).slice(0, 5)) {
    const p = String(s?.param ?? '');
    if (!PARAM.test(p) || p === field || !s.values || typeof s.values !== 'object' || Array.isArray(s.values)) continue;
    const values = {};
    for (const [value, phrases] of Object.entries(s.values).slice(0, 50)) {
      const clean = [...new Set((Array.isArray(phrases) ? phrases : []).slice(0, 50).map((x) => String(x ?? '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim()).filter((x) => x && x.length <= 40))];
      if (value && clean.length) values[value] = clean;
    }
    if (Object.keys(values).length) out.push({ param: p, ...(s.list === true ? { list: true } : {}), values });
  }
  return out;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const NOT_IN_WORD = '[\\p{L}\\p{N}]';

/**
 * Take a word's slot phrases off a line: a phrase counts only as whole words (any case) at the START or the END of the
 * line, the longest first, again until none is left; one in the middle is part of the question ('koekjes bij ah bonus'),
 * and one inside a longer word never matches ('bij ahornsiroop'). A phrase is not taken when nothing would be left to
 * ask. A `list` slot gathers every value it found (`stores: ['jumbo', 'ah']`), a plain one keeps the first.
 * @param {string} line
 * @param {Array<{param: string, list?: boolean, values: Record<string, string[]>}>} [slots]
 * @returns {{rest: string, filled: Record<string, string|string[]>}}
 */
export function takeSlots(line, slots) {
  // one form for what was typed and what was placed (a combining accent typed is the precomposed one written)
  let rest = String(line ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  const filled = {};
  const phrases = (Array.isArray(slots) ? slots : []).flatMap((s) => Object.entries(s?.values ?? {}).flatMap(([value, ps]) => (Array.isArray(ps) ? ps : []).map((p) => ({ slot: s, value, phrase: String(p ?? '').normalize('NFC').trim() }))))
    .filter((p) => p.phrase)
    .sort((a, b) => b.phrase.length - a.phrase.length);
  if (!phrases.length) return { rest, filled };
  // a sentence's marks at either end ('bij ah?', 'bij Albert Heijn.') never hide a phrase
  const edges = (s) => s.replace(/^[\s?.!,]+|[\s?.!,]+$/gu, '');
  rest = edges(rest) || rest;
  const fill = ({ slot, value }) => {
    if (slot.list) { const had = Object.hasOwn(filled, slot.param) ? filled[slot.param] : []; if (!had.includes(value)) filled[slot.param] = [...had, value]; }
    else if (!Object.hasOwn(filled, slot.param)) filled[slot.param] = value;
  };
  for (let changed = true; changed;) {
    changed = false;
    for (const p of phrases) {
      const body = p.phrase.split(' ').map(escapeRe).join('\\s+');
      const lead = new RegExp(`^${body}(?!${NOT_IN_WORD})`, 'iu').exec(rest);
      const tail = lead ? null : new RegExp(`(?<!${NOT_IN_WORD})${body}$`, 'iu').exec(rest);
      const hit = lead ?? tail;
      if (!hit) continue;
      // a comma between the phrase and the question ('melk, bij jumbo') goes with the phrase
      const left = edges(lead ? rest.slice(hit[0].length) : rest.slice(0, hit.index));
      if (!left) continue;
      rest = left; fill(p); changed = true;
      break;
    }
  }
  return { rest, filled };
}

/**
 * The deterministic gate's rule for a toolbox's words: a line that starts with a word the admin named (with or without
 * its slash) and asks something after it becomes `useTool`, the rest of the line in the tool's named field (`query`).
 * The words are read live (`getWords`), so a toolbox added or removed changes what the gate hears at once.
 * @param {() => Array<{word: string, tool: string, field?: string, toolbox: string}>} getWords
 * @returns {{name: string, test: (text: string) => boolean, command: (text: string) => object|null}}
 */
export function toolboxGateRule(getWords) {
  const command = (text) => {
    const m = /^\s*\/?(\S+)\s+(\S[\s\S]*?)\s*$/u.exec(String(text ?? ''));
    if (!m) return null;
    const w = (typeof getWords === 'function' ? getWords() : []).find((x) => x.word === m[1].toLowerCase());
    if (!w) return null;
    // the word's slots ('bij Albert Heijn' → stores: ['ah']) come off the line first; what is left is the question
    const { rest, filled } = takeSlots(m[2].replace(/\s+/g, ' '), w.slots);
    return { opId: 'useTool', appOrigin: 'tools', args: { toolbox: w.toolbox, tool: w.tool, input: { [w.field ?? 'query']: rest, ...filled } } };
  };
  return { name: 'tools:useTool(word)', test: (text) => Boolean(command(text)), command };
}

/**
 * The answer to "which one" in WORDS, at every door (ledger L1035): `2` or `kies 2` (and `kies 2 1`, the list asked
 * for after it) picks thing 2 of the LAST list of things shown in this thread, as the row's button does: the button
 * only sends the same thing. A number with no list open here, or past its end, is an ordinary line: the rule does not
 * take it. The thread is the gate's `ctx.id` (the door's thread), the key the list was kept under.
 * @param {ReturnType<typeof makeChoiceKeeper>} keeper
 */
export function toolChoiceGateRule(keeper) {
  const command = (text, ctx) => {
    const m = /^\s*(?:\/?kies\s+)?(\d{1,2})(?:\s+(\d{1,2}))?\s*\.?\s*$/iu.exec(String(text ?? ''));
    if (!m) return null;
    const thread = choiceThreadOf(ctx);
    if (!thread || !keeper?.take?.(thread, m[1])) return null;
    return { opId: 'pickThing', appOrigin: 'tools', args: { spec: m[2] ? `${m[1]} ${m[2]}` : m[1] } };
  };
  return { name: 'tools:pickThing(number)', test: (text, ctx) => Boolean(command(text, ctx)), command };
}

/**
 * The toolboxes in words, one line per toolbox under a head, or the sentence for none: what `/toolbox` says to the
 * admin (`all`: every PLACED one, on or off; none placed yet), and what `listTools` answers anywhere it is painted (a
 * member: the ones ON; none on right now), so a screen never shows a bare tick.
 * @param {Array<{name: string, title?: string, on?: boolean, words?: Array<{word: string}>}>} rows @param {Function} tp
 * @param {{all?: boolean}} [o]
 */
export function toolboxListLine(rows, tp, { all = false } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return tp(all ? 'circle.bot.toolbox_none' : 'circle.bot.toolbox_none_on');
  return [tp('circle.bot.toolbox_list_head'), ...list.map((b) => tp('circle.bot.toolbox_row', {
    title: b.title ?? b.name, name: b.name, state: tp(b.on ? 'circle.bot.toolbox_state_on' : 'circle.bot.toolbox_state_off'),
    words: b.words?.length ? ` · ${b.words.map((w) => `${w.word} <…>`).join(', ')}` : '',
  }))].join('\n');
}

/** The door's words for a toolbox refusal code (`circle.bot.toolbox_*`), the same from `/toolbox` and from a tool's use. */
const REFUSAL_KEY = Object.freeze({
  'toolbox-not-placed': 'toolbox_not_placed', 'toolbox-no-key': 'toolbox_no_key', 'toolbox-off': 'toolbox_is_off',
  'toolbox-unreachable': 'toolbox_unreachable', 'toolbox-no-endpoint': 'toolbox_unreachable', 'toolbox-unauthorized': 'toolbox_unreachable',
  'toolbox-error': 'toolbox_unreachable', 'toolbox-timeout': 'toolbox_timeout', 'tool-not-offered': 'toolbox_tool_not_offered', 'toolbox-word-taken': 'toolbox_word_taken',
  'tool-error': 'toolbox_tool_failed', 'toolbox-bad-answer': 'toolbox_failed',
});

/**
 * A toolbox result told in the door's words: the refusal's sentence (never a key, never an address), or null when it
 * is not a refusal. `title` is the toolbox's name as its card gives it, when known.
 * @param {{ok: boolean, code?: string, name?: string, title?: string, tool?: string}} r @param {Function} t
 */
export function toolboxRefusalText(r, t) {
  if (!r || r.ok !== false) return null;
  const key = REFUSAL_KEY[r.code] ?? 'toolbox_failed';
  return t(`circle.bot.${key}`, { name: r.name ?? '', title: r.title ?? r.name ?? '', tool: r.tool ?? '', word: r.word ?? '' });
}

/**
 * The help line per word of an ON toolbox: 'zoek <iets>: zoekt producten bij Boodschappen' (the operator's `says` in
 * this language, else 'gebruikt <title>').
 * @param {Array<{word: string, title: string, says?: Record<string, string>}>} words @param {Function} t @param {string} [lang]
 * @returns {string[]}
 */
export function toolboxHelpLines(words, t, lang = 'nl') {
  return (Array.isArray(words) ? words : []).map((w) => t('circle.bot.toolbox_help_line', {
    word: w.word, says: w.says?.[lang] ?? w.says?.nl ?? t('circle.bot.toolbox_says_default', { title: w.title ?? w.toolbox }),
  }));
}

/** The welcome's one line when an ON toolbox has words, else null. */
export function toolboxWelcomeLine(words, t, lang = 'nl') {
  const lines = toolboxHelpLines(words, t, lang);
  return lines.length ? t('circle.bot.toolbox_welcome', { lines: lines.join('; ') }) : null;
}

/** The device-log kind of a toolbox call's record (packages/item-store entryKinds: kept like the own record, local). */
/** How long a thread's last list of things can still be answered with a tap (the box's memory; gone on a restart). */
export const CHOICE_KEEP = param({ key: 'tools.choiceKeepMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30 * 60_000 });

/**
 * The key a thread's kept list of things lives under: ONE rule for the gate rule (which gets the engine's `ctx.id`) and
 * the ops (which get the door's `ctx.threadId`, else the person), so a typed '2' and a button find the same list.
 * @param {{threadId?: string, id?: string, caller?: string}|null} ctx
 * @returns {string|null}
 */
export function choiceThreadOf(ctx) {
  return ctx?.threadId ?? ctx?.id ?? ctx?.caller ?? null;
}

/**
 * The last list of things shown in each thread, so a button can carry only its number (Telegram caps a button's data
 * at 64 bytes). The next list in a thread replaces the last; another thread has its own; an old list is gone.
 * @param {{now?: () => number, keepMs?: number}} [o]
 */
export function makeChoiceKeeper({ now = () => Date.now(), keepMs = CHOICE_KEEP } = {}) {
  const kept = new Map();
  let seq = 0;
  return {
    /**
     * Keep a thread's list; returns its short tag, which its buttons carry (`<tag>.<n>`), so a button of an OLDER message
     * never picks from the list kept after it.
     */
    keep(threadId, items) {
      const tag = `${(now() % 46656).toString(36)}${(seq++ % 36).toString(36)}`;
      if (threadId) kept.set(String(threadId), { at: now(), tag, items: Array.isArray(items) ? items.slice() : [] });
      return tag;
    },
    /**
     * Thing `n` (1-based) of the thread's last list, or null when there is none, it is old, or `n` was not shown. A
     * tagged pick (`<tag>.<n>`, a button) must name the kept list; a bare number (typed) means the last list.
     */
    take(threadId, pick) {
      const k = kept.get(String(threadId ?? ''));
      if (!k || now() - k.at > keepMs) return null;
      const [tag, n] = String(pick ?? '').includes('.') ? String(pick).split('.') : [null, pick];
      if (tag !== null && tag !== k.tag) return null;
      const i = Number(n);
      return Number.isInteger(i) && i >= 1 && i <= k.items.length ? k.items[i - 1] : null;
    },
    /** The thread's kept list itself, when `tag` names it and it is not old: what "meer" pages through. */
    list(threadId, tag) {
      const k = kept.get(String(threadId ?? ''));
      if (!k || now() - k.at > keepMs || String(tag ?? '') !== k.tag) return null;
      return k.items.slice();
    },
  };
}

/** A thing's row: its name, then what tells it apart (its detail) and its price, as given; the shop is the row's head. */
const thingRow = (x, t) => {
  const more = [x.detail && x.detail !== x.seller ? x.detail : null, x.price ? `€ ${String(x.price).replace('.', ',')}` : null].filter(Boolean).join(' · ');
  return more ? t('circle.bot.toolbox_found_row', { label: x.label, more }) : String(x.label ?? '');
};

/**
 * A toolbox's list of things as the door paints a list (`useTool` replies a list): a row per thing with its detail.
 * Each row is a `tool-thing` numbered from 1, so the button the tools manifest declares for it (`pickThing`, the
 * answer to "which one", ledger L1035) is painted by the shared row buttons: `pickThing:<n>`, well under Telegram's 64
 * bytes. The list is kept, as the toolbox gave it, for the thread it was shown in. Anything else (a refusal, nothing
 * found, an answer that is not a list) passes unchanged.
 * @param {object} r  `useTool`'s answer
 * @param {{threadId: string, keeper: ReturnType<typeof makeChoiceKeeper>, t: Function}} o
 */
export function toolChoicesReply(r, { threadId, keeper, t }) {
  const found = r?.ok && Array.isArray(r.items) ? r.items : null;
  if (!found || !found.length) return r;
  // per shop, in the order the shops first came (the shop is the row's head): kept in that same order, so the number a
  // row shows is the number a tap or a typed '2' picks
  const order = [...new Set(found.map((x) => String(x?.seller ?? '')))];
  const items = order.flatMap((s) => found.filter((x) => String(x?.seller ?? '') === s));
  const tag = keeper?.keep?.(threadId, items) ?? null;
  // a row of type `tool-thing`, numbered: the manifest's row button (`tools.pickThing`) is painted on it by the shared
  // renderer, as on every surface that paints an answer's items
  return {
    ...r,
    title: r.title ?? r.name,
    // the row's id is its button's data: the kept list's tag and the number (`pickThing:<tag>.<n>`)
    items: items.map((x, i) => thingItem(x, i + 1, tag, t)),
  };
}

/** A kept thing as a row: its button's data names the kept list and its number (`<tag>.<n>`), and `n` is the number a
 *  door shows, so a later page ("meer") keeps each thing's own number. */
function thingItem(x, n, tag, t) {
  return { id: tag ? `${tag}.${n}` : String(n), n, type: 'tool-thing', label: thingRow(x, t), ...(x?.seller ? { seller: String(x.seller) } : {}), ...(x?.thumb ? { thumb: x.thumb } : {}) };
}

/**
 * "Meer van <winkel>" (ledger L1035, Frits): the rest of one shop's things from the thread's KEPT list, from `from` on,
 * each with its own number, so a typed '7' or a card's button still picks the same thing. A read of what was already
 * fetched: no new call to the toolbox, nothing leaves. `spec` is `<tag> <shop index> <from>`, the button's own line.
 * @param {{keeper: ReturnType<typeof makeChoiceKeeper>, t: Function}} o
 */
export function makeMoreThings({ keeper, t }) {
  return async (args, ctx) => {
    const [tag, gi, from] = String(args?.spec ?? args?._match ?? '').trim().split(/\s+/);
    const thread = choiceThreadOf(ctx);
    const kept = keeper?.list?.(thread, tag);
    const gone = { ok: false, error: { code: 'list-gone', message: t('circle.bot.toolbox_more_gone') } };
    if (!kept) return gone;
    // the shops as the door numbers them: the named ones in the order they first come, things with no shop last
    const named = [...new Set(kept.map((x) => String(x?.seller ?? '')).filter(Boolean))];
    const shops = kept.some((x) => !String(x?.seller ?? '')) ? [...named, ''] : named;
    const g = Number(gi);
    if (!Number.isInteger(g) || g < 0 || g >= shops.length) return gone;
    const start = Math.max(0, Number(from) || 0);
    const rows = kept.map((x, i) => ({ x, n: i + 1 })).filter(({ x }) => String(x?.seller ?? '') === shops[g]).slice(start);
    if (!rows.length) return gone;
    return { ok: true, title: shops[g] || null, page: { tag, group: g, from: start }, items: rows.map(({ x, n }) => thingItem(x, n, tag, t)) };
  };
}

/**
 * Which list a chosen thing goes on: the list of the shop that sells it (its name holds the seller's, as a shop visit
 * matches), else the household's shopping list (the template's shopping role), else none: the door asks.
 * @param {{seller?: string}} thing @param {Array<{label: string}>} lists @param {string|null} shopping
 */
export function listForThing(thing, lists, shopping) {
  const seller = String(thing?.seller ?? '').trim().toLowerCase();
  const own = seller ? lists.find((l) => String(l.label ?? '').toLowerCase().includes(seller)) : null;
  if (own) return own.label;
  return shopping && lists.some((l) => l.label === shopping) ? shopping : null;
}

/**
 * `tools.pickThing` — the answer to "which one" after a list of things (`/kies <n>`, or the row's button). Thing `n` of
 * the list shown in THIS thread goes on a list as the person who tapped: the list of the shop that sells it, else the
 * shopping list, else the reply asks which list (`/kies <n> <list>`, as quick replies). The thing's reference and
 * quantity 1 ride along; the same thing again raises the quantity (the lists op says so, here in the person's words).
 * @param {{keeper: ReturnType<typeof makeChoiceKeeper>, callSkill: Function, shoppingList: () => string|null}} o
 * @returns {(args: {spec?: string, _match?: string}, ctx: object, t: Function) => Promise<object>}
 */
export function makePickThing({ keeper, callSkill, shoppingList = () => null }) {
  return async (args, ctx, t) => {
    const [n, m] = String(args?.spec ?? args?._match ?? '').trim().split(/\s+/);
    const thing = keeper?.take?.(choiceThreadOf(ctx), n) ?? null;
    if (!thing) return { ok: false, error: { code: 'choice-gone', message: t('circle.bot.toolbox_pick_gone') } };
    const read = await callSkill('lists', 'listLists', {}, ctx);
    const lists = (read?.ok && Array.isArray(read.items) ? read.items : []).filter((l) => l?.type === 'list' && l.label);
    // the list a button names by its id (a list added in between never moves the thing elsewhere); a typed number is the
    // place the person sees
    const named = m !== undefined ? (lists.find((l) => l.id !== undefined && String(l.id) === m) ?? (/^\d+$/.test(m) ? lists[Number(m) - 1] : null)) : null;
    const chosen = m !== undefined ? (named?.label ?? null) : listForThing(thing, lists, shoppingList());
    if (!chosen) {
      if (!lists.length) return { ok: false, error: { code: 'no-list', message: t('circle.bot.toolbox_pick_no_list') } };
      return { ok: true, message: t('circle.bot.toolbox_pick_which_list', { label: thing.label }),
        quickReplies: lists.map((l, i) => ({ label: String(l.label).slice(0, 60), slash: `/kies ${n} ${l.id ?? i + 1}` })) };
    }
    const ref = thing.ref && typeof thing.ref.type === 'string' && typeof thing.ref.ref === 'string' ? { type: thing.ref.type, ref: thing.ref.ref } : undefined;
    // the person's own act at the bot (their tap, or the number they typed): it names its door, so the circle's switches apply
    const r = await callSkill('lists', 'addToList', { list: chosen, text: thing.label, ...(ref ? { ref } : {}), quantity: 1 }, { ...ctx, door: 'bot' });
    if (!r?.ok) return { ok: false, error: { code: r?.code ?? 'refused', message: typeof r?.error === 'string' ? r.error : (r?.error?.message ?? t('circle.bot.toolbox_pick_failed')) } };
    if (r.duplicate) return { ok: true, message: t('circle.lists.quantity_raised', { item: thing.label, list: chosen, quantity: r.quantity }) };
    return { ok: true, message: t('circle.bot.toolbox_pick_added', { list: chosen, label: thing.label }) };
  };
}

export const TOOL_CALL_KIND = 'tool-call';

/**
 * One record of a toolbox call: the whitelisted keys only (who asked, which toolbox, which tool, how it ended), never
 * the words of the question, whatever else the caller holds.
 * @param {{person?: string|null, toolbox?: string|null, tool?: string|null, outcome?: string, ts?: number}} a
 */
export function makeToolCallEntry({ person = null, toolbox = null, tool = null, outcome = 'ok', ts = Date.now() } = {}) {
  const str = (v) => (typeof v === 'string' && v ? v : null);
  return {
    id: `${TOOL_CALL_KIND}:${ts.toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
    type: TOOL_CALL_KIND, ts, silent: true,
    payload: { person: str(person), toolbox: str(toolbox), tool: str(tool), outcome: ['ok', 'refused', 'failed'].includes(outcome) ? outcome : 'failed' },
  };
}

/**
 * The words a door already uses, which a toolbox may not take: its slash commands (without the slash), the first word
 * of every verb and gate word its manifests answer to, and the first word of every example of the box's own gate.
 * @param {{commands?: string[], manifests?: object[]}} a
 * @returns {Set<string>}
 */
export function doorTakenWords({ commands = [], manifests = [] } = {}) {
  const out = new Set(firstPartyFirstWords(manifests));
  for (const c of commands) { const w = String(c ?? '').replace(/^\//, '').trim().toLowerCase(); if (w) out.add(w); }
  for (const lang of Object.values(GATE_WORDS)) {
    for (const entry of Object.values(lang ?? {})) {
      for (const ex of entry?.examples ?? []) { const w = String(ex).trim().split(/\s+/)[0]?.toLowerCase().replace(/[^a-zà-ÿ0-9-]/g, ''); if (w) out.add(w); }
    }
  }
  return out;
}
