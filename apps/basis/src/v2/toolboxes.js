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

const RECORDS_KEY = 'tools.toolboxes';
const NAME = /^[a-z][a-z0-9-]{0,31}$/;
const WORD = /^[a-zà-ÿ][a-zà-ÿ0-9-]{0,23}$/;

/**
 * @param {object} a
 * @param {{get: (k: string) => Promise<string|null>, set: (k: string, v: string) => Promise<void>}} a.store   the box's vault
 * @param {(name: string) => Promise<string|null>} a.keyOf   the operator's key for a toolbox, or null
 * @param {Function} [a.fetch]
 * @param {(...a: unknown[]) => void} [a.log]   codes only
 */
export function makeToolboxOps({ store, keyOf, fetch = globalThis.fetch, log = () => {} } = {}) {
  const read = async () => { try { const v = JSON.parse((await store.get(RECORDS_KEY)) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
  // the words, held in memory for the deterministic gate (a rule answers synchronously); kept in step with every write
  let words = [];
  const remember = (records) => { words = records.flatMap((r) => (r.words ?? []).map((w) => ({ ...w, toolbox: r.name }))); };
  const write = async (records) => { await store.set(RECORDS_KEY, JSON.stringify(records)); remember(records); };
  const keyFor = async (name) => { try { const k = await keyOf(name); return typeof k === 'string' && k.trim() ? k.trim() : null; } catch { return null; } };
  const wordsOk = (words) => Array.isArray(words) && words.length > 0
    && words.every((w) => w && WORD.test(String(w.word ?? '')) && typeof w.tool === 'string' && w.tool && (w.field == null || typeof w.field === 'string'));

  return {
    /** Read the records once at start, so the gate knows the words before the first add of this run. */
    async load() { remember(await read()); },
    /** The words that reach a tool now: `{word, tool, field?, toolbox}` (for the gate; no key, no address). */
    wordsNow: () => words,

    /** The admin adds a toolbox: its name, its address, the words for its tools. The key must already be on the box. */
    async addToolbox({ name, url, words } = {}) {
      const n = String(name ?? '').trim();
      if (!NAME.test(n)) return { ok: false, code: 'toolbox-bad-name' };
      if (!/^https?:\/\/[^\s/]+/.test(String(url ?? ''))) return { ok: false, code: 'toolbox-bad-address', name: n };
      if (!wordsOk(words)) return { ok: false, code: 'toolbox-bad-words', name: n };
      if (!(await keyFor(n))) { log('tools', 'refused', { check: 'add', reason: 'toolbox-no-key' }); return { ok: false, code: 'toolbox-no-key', name: n }; }
      const card = await readToolboxCard(url, { fetch });
      if (!card.ok) { log('tools', 'refused', { check: 'card', reason: card.code }); return { ok: false, code: card.code, name: n }; }
      const offered = new Set(card.tools.map((t) => t.id));
      const missing = words.find((w) => !offered.has(w.tool));
      if (missing) return { ok: false, code: 'tool-not-offered', name: n, tool: missing.tool };
      const record = { name: n, url: String(url), endpoint: card.endpoint, title: card.name, tools: card.tools,
        words: words.map((w) => ({ word: String(w.word).toLowerCase(), tool: w.tool, ...(w.field ? { field: w.field } : {}) })) };
      await write([...(await read()).filter((r) => r.name !== n), record]);
      return { ok: true, name: n, tools: card.tools.map((t) => t.id) };
    },

    /** The admin removes a toolbox: removing it is the switch (no capability row per toolbox). */
    async removeToolbox({ name } = {}) {
      const n = String(name ?? '').trim();
      const records = await read();
      if (!records.some((r) => r.name === n)) return { ok: false, code: 'toolbox-not-added', name: n };
      await write(records.filter((r) => r.name !== n));
      return { ok: true, name: n };
    },

    /** The toolboxes and their tools and words. Never a key. */
    async listTools() {
      const records = await read();
      return { ok: true, toolboxes: records.map((r) => ({ name: r.name, title: r.title ?? r.name, words: r.words, tools: r.tools })) };
    },

    /**
     * A member uses a tool. Refused before anything leaves when the toolbox is not added, the tool is not one it
     * offers, or its key is not on the box. A list of things comes back as choices (`items`); anything else as `output`.
     */
    async useTool({ toolbox, tool, input } = {}) {
      const n = String(toolbox ?? '').trim();
      const record = (await read()).find((r) => r.name === n);
      if (!record) return { ok: false, code: 'toolbox-not-added', name: n };
      if (!record.tools?.some((t) => t.id === tool)) return { ok: false, code: 'tool-not-offered', name: n, tool };
      const key = await keyFor(n);
      if (!key) { log('tools', 'refused', { check: 'use', reason: 'toolbox-no-key' }); return { ok: false, code: 'toolbox-no-key', name: n }; }
      const r = await callTool({ endpoint: record.endpoint, key, tool, input: input && typeof input === 'object' ? input : {}, fetch });
      if (!r.ok) { log('tools', 'refused', { check: 'call', reason: r.code, ...(r.toolCode ? { toolCode: r.toolCode } : {}) }); return { ...r, name: n }; }
      const list = readItemList(r.output, { source: n });
      return list.ok ? { ok: true, name: n, tool, items: list.items } : { ok: true, name: n, tool, output: r.output };
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
