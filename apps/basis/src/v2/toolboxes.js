/**
 * toolboxes — a circle's toolboxes on its box, and the four ops over them (ledger L1035, slice 3).
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
import { readToolboxCard, callTool, readItemList } from './toolboxClient.js';

const ON_KEY = 'tools.on';
const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const WORD = /^[a-zà-ÿ][a-zà-ÿ0-9-]{0,23}$/;

/** A placed file as the operator wrote it, or null when it is not one (a bad name, address or words). */
function readPlaced(p) {
  const name = String(p?.name ?? '').trim();
  if (!NAME.test(name) || !/^https?:\/\/[^\s/]+/.test(String(p?.url ?? ''))) return null;
  const words = (Array.isArray(p?.words) ? p.words : [])
    .filter((w) => w && WORD.test(String(w.word ?? '').toLowerCase()) && typeof w.tool === 'string' && w.tool)
    .map((w) => ({
      word: String(w.word).toLowerCase(), tool: w.tool, ...(typeof w.field === 'string' && w.field ? { field: w.field } : {}),
      // what the word does, in a person's words per language (the operator's: 'zoekt producten'), for /help and the welcome
      ...(w.says && typeof w.says === 'object' ? { says: Object.fromEntries(Object.entries(w.says).filter(([, v]) => typeof v === 'string' && v.trim())) } : {}),
    }));
  return { name, url: String(p.url), words };
}

/**
 * @param {object} a
 * @param {{get: (k: string) => Promise<string|null>, set: (k: string, v: string) => Promise<void>}} a.store   the box's vault: which are ON, and the card read at the yes
 * @param {() => Promise<object[]>} a.placedOf   the operator's placed toolboxes (one file each: name, address, words)
 * @param {(name: string) => Promise<string|null>} a.keyOf   the operator's key for a toolbox, or null
 * @param {Function} [a.fetch]
 * @param {(...a: unknown[]) => void} [a.log]   codes only
 */
export function makeToolboxOps({ store, placedOf = async () => [], keyOf, fetch = globalThis.fetch, log = () => {} } = {}) {
  const readOn = async () => { try { const v = JSON.parse((await store.get(ON_KEY)) ?? '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
  const placed = async () => { try { return (await placedOf() ?? []).map(readPlaced).filter(Boolean); } catch { return []; } };
  const keyFor = async (name) => { try { const k = await keyOf(name); return typeof k === 'string' && k.trim() ? k.trim() : null; } catch { return null; } };
  // the words of the toolboxes that are ON, held in memory for the deterministic gate (a rule answers synchronously)
  let words = [];
  const remember = async (onMap) => {
    const ps = await placed();
    words = ps.filter((p) => onMap[p.name]).flatMap((p) => p.words.map((w) => ({ ...w, toolbox: p.name, title: onMap[p.name].title ?? p.name })));
  };
  const writeOn = async (onMap) => { await store.set(ON_KEY, JSON.stringify(onMap)); await remember(onMap); };

  return {
    /** Read once at start, so the gate knows the words of what is on before the first switch of this run. */
    async load() { await remember(await readOn()); },
    /** The words that reach a tool now (ON toolboxes only): `{word, tool, field?, toolbox, title}`. No key, no address. */
    wordsNow: () => words,

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
      const offered = new Set(card.tools.map((t) => t.id));
      const missing = p.words.find((w) => !offered.has(w.tool));
      if (missing) return { ok: false, code: 'tool-not-offered', name: n, tool: missing.tool };
      // what it receives, as codes the door words: the words of a question always; a list's references when a word's
      // tool is one that prices a list (a `keys` field, Fable's section 7)
      const receives = ['question', ...(p.words.some((w) => w.field === 'keys') ? ['list-refs'] : [])];
      if (!confirm) return { ok: true, pending: true, name: n, title: card.name || n, url: p.url, words: p.words, receives };
      const onMap = await readOn();
      onMap[n] = { title: card.name || n, endpoint: card.endpoint, tools: card.tools.map((t) => ({ id: t.id, name: t.name })) };
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
      const rows = (await placed()).map((p) => ({ name: p.name, title: onMap[p.name]?.title ?? p.name, on: Boolean(onMap[p.name]), words: p.words }));
      return { ok: true, toolboxes: all ? rows : rows.filter((r) => r.on) };
    },

    /**
     * A member uses a tool of an ON toolbox. Refused before anything leaves when the toolbox is off or not placed, the
     * tool is not one its card offered, or its key is not on the box. A list of things comes back as choices (`items`).
     */
    async useTool({ toolbox, tool, input } = {}) {
      const n = String(toolbox ?? '').trim();
      const live = (await readOn())[n];
      if (!live || !(await placed()).some((p) => p.name === n)) return { ok: false, code: 'toolbox-off', name: n };
      if (!live.tools?.some((t) => t.id === tool)) return { ok: false, code: 'tool-not-offered', name: n, tool };
      const key = await keyFor(n);
      if (!key) { log('tools', 'refused', { check: 'use', reason: 'toolbox-no-key' }); return { ok: false, code: 'toolbox-no-key', name: n }; }
      const r = await callTool({ endpoint: live.endpoint, key, tool, input: input && typeof input === 'object' ? input : {}, fetch });
      if (!r.ok) { log('tools', 'refused', { check: 'call', reason: r.code, ...(r.toolCode ? { toolCode: r.toolCode } : {}) }); return { ...r, name: n }; }
      const list = readItemList(r.output, { source: n });
      return list.ok ? { ok: true, name: n, title: live.title, tool, items: list.items } : { ok: true, name: n, title: live.title, tool, output: r.output };
    },
  };
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
    const rest = m[2].replace(/\s+/g, ' ');
    return { opId: 'useTool', appOrigin: 'tools', args: { toolbox: w.toolbox, tool: w.tool, input: { [w.field ?? 'query']: rest } } };
  };
  return { name: 'tools:useTool(word)', test: (text) => Boolean(command(text)), command };
}

/** The door's words for a toolbox refusal code (`circle.bot.toolbox_*`), the same from `/toolbox` and from a tool's use. */
const REFUSAL_KEY = Object.freeze({
  'toolbox-not-placed': 'toolbox_not_placed', 'toolbox-no-key': 'toolbox_no_key', 'toolbox-off': 'toolbox_is_off',
  'toolbox-unreachable': 'toolbox_unreachable', 'toolbox-no-endpoint': 'toolbox_unreachable', 'toolbox-unauthorized': 'toolbox_unreachable',
  'toolbox-error': 'toolbox_unreachable', 'toolbox-timeout': 'toolbox_timeout', 'tool-not-offered': 'toolbox_tool_not_offered',
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
  return t(`circle.bot.${key}`, { name: r.name ?? '', title: r.title ?? r.name ?? '', tool: r.tool ?? '' });
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
