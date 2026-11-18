/**
 * toolboxClient — how the box calls a TOOLBOX's tool: A2A 1.0 over HTTP (ledger L1035, slice 3).
 *
 * A toolbox answers when asked, keeps nothing of the circle and acts for nobody; a tool is one callable function on
 * it. This is the one small client for that wire, in shared code, with no dependency (the brief: no new package unless
 * the install survives it). It speaks exactly what a toolbox answered on 2026-11-18 (`@a2a-js/sdk` 1.3.0, A2A 1.0):
 *   - the card at `/.well-known/agent-card.json`, readable without the key; the endpoint is `supportedInterfaces[0].url`
 *     (a JSON-RPC 1.0 interface);
 *   - a call is `POST <endpoint>`, JSON-RPC `SendMessage`, headers `Authorization: Bearer <key>` and `A2A-Version: 1.0`,
 *     one data part `{operation, input}`;
 *   - the answer is `result.message.parts[0].data`: `{operation, output}`, or the tool's own error
 *     `{operation, error: {code, params}}` at HTTP 200; the endpoint's own errors are JSON-RPC errors with a status.
 * Every failure ends in ONE code (never a throw): `toolbox-unreachable` · `toolbox-unauthorized` · `toolbox-error` ·
 * `toolbox-timeout` · `toolbox-bad-answer` · `toolbox-no-endpoint` · `tool-error` (+ the tool's own `toolCode`).
 *
 * NOT the native path: core's `packages/core/src/a2a` speaks an earlier REST draft (`POST /tasks/send`); a toolbox
 * speaks current A2A, so the two do not share code.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

/** How long one tool call may take before it is given up (a filtered search fetches details first). */
export const TOOL_CALL_TIMEOUT = param({ key: 'tools.callTimeoutMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 30_000 });

const CARD_PATH = '/.well-known/agent-card.json';
const trimSlash = (s) => String(s ?? '').replace(/\/+$/, '');
const messageId = () => `basis-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

/** Race a promise against a timer; the loser is ignored. */
function within(ms, promise) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), ms); });
  return Promise.race([promise.then((v) => ({ value: v }), (e) => ({ error: e })), timeout]).finally(() => clearTimeout(timer));
}

/**
 * A toolbox's card: its name, its endpoint, its tools. Read without the key.
 * @param {string} baseUrl  the toolbox's address (`http://boodschappen:3000`)
 * @param {{fetch?: Function, timeoutMs?: number}} [o]
 * @returns {Promise<{ok: true, name: string, endpoint: string, tools: Array<{id: string, name: string, description: string}>}|{ok: false, code: string}>}
 */
export async function readToolboxCard(baseUrl, { fetch = globalThis.fetch, timeoutMs = TOOL_CALL_TIMEOUT.default } = {}) {
  const r = await within(timeoutMs, Promise.resolve().then(() => fetch(`${trimSlash(baseUrl)}${CARD_PATH}`, { method: 'GET', headers: { Accept: 'application/json' } })));
  if (r.timedOut) return { ok: false, code: 'toolbox-timeout' };
  if (r.error || !r.value?.ok) return { ok: false, code: 'toolbox-unreachable' };
  let card;
  try { card = await r.value.json(); } catch { return { ok: false, code: 'toolbox-bad-answer' }; }
  const iface = (Array.isArray(card?.supportedInterfaces) ? card.supportedInterfaces : [])
    .find((i) => typeof i?.url === 'string' && i.url && (i.protocolBinding ?? 'JSONRPC') === 'JSONRPC');
  if (!iface) return { ok: false, code: 'toolbox-no-endpoint' };
  const tools = (Array.isArray(card?.skills) ? card.skills : [])
    .filter((s) => typeof s?.id === 'string' && s.id)
    .map((s) => ({ id: s.id, name: typeof s.name === 'string' ? s.name : s.id, description: typeof s.description === 'string' ? s.description : '' }));
  return { ok: true, name: typeof card?.name === 'string' ? card.name : '', endpoint: iface.url, tools };
}

/**
 * Call one tool. What leaves: the tool's id and its input, nothing else (no person, no circle).
 * @param {object} a
 * @param {string} a.endpoint  from the card
 * @param {string} a.key       the toolbox's key (the box's vault; never logged)
 * @param {string} a.tool      the tool's id (`products.choices`)
 * @param {object} [a.input]
 * @param {Function} [a.fetch] @param {number} [a.timeoutMs]
 * @returns {Promise<{ok: true, output: unknown}|{ok: false, code: string, toolCode?: string}>}
 */
export async function callTool({ endpoint, key, tool, input = {}, fetch = globalThis.fetch, timeoutMs = TOOL_CALL_TIMEOUT.default }) {
  const body = {
    jsonrpc: '2.0', id: 1, method: 'SendMessage',
    params: { message: { messageId: messageId(), role: 'ROLE_USER', parts: [{ data: { operation: tool, input: input ?? {} } }] } },
  };
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json', 'A2A-Version': '1.0', ...(key ? { Authorization: `Bearer ${key}` } : {}) };
  const r = await within(timeoutMs, Promise.resolve().then(() => fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) })));
  if (r.timedOut) return { ok: false, code: 'toolbox-timeout' };
  if (r.error) return { ok: false, code: 'toolbox-unreachable' };
  let json = null;
  try { json = await r.value.json(); } catch { json = null; }
  if (!r.value.ok) {
    if (r.value.status === 401 || json?.error?.data?.code === 'unauthorized') return { ok: false, code: 'toolbox-unauthorized' };
    return { ok: false, code: 'toolbox-error' };
  }
  if (json?.error) return { ok: false, code: json.error?.data?.code === 'unauthorized' ? 'toolbox-unauthorized' : 'toolbox-error' };
  const data = json?.result?.message?.parts?.[0]?.data;
  if (!data || typeof data !== 'object') return { ok: false, code: 'toolbox-bad-answer' };
  if (data.error && typeof data.error === 'object') return { ok: false, code: 'tool-error', toolCode: String(data.error.code ?? 'unknown') };
  if (!('output' in data)) return { ok: false, code: 'toolbox-bad-answer' };
  return { ok: true, output: data.output };
}

/**
 * A tool's answer that is a list of THINGS: a schema.org `ItemList` whose elements hold a Thing (`@type`,
 * `identifier`, `name`, and optionally `description`, `image`, `offers`). Basis reads the Thing part only; the
 * entry's reference is `{type: @type as given, ref: identifier as given}` (so the toolbox's own page, adding the same
 * thing through the door, lands on the SAME entry), and the toolbox rides beside it as `source`, never as identity.
 * A price is read for a choice's detail line only, never stored. Anything else is ONE refusal code.
 * @param {unknown} output
 * @param {{source?: string}} [o]
 * @returns {{ok: true, items: Array<{label: string, detail: string|null, image: string|null, price: string|null, seller: string|null, ref: {type: string, ref: string, source?: string}}>}|{ok: false, code: 'not-an-item-list'}}
 */
export function readItemList(output, { source = null } = {}) {
  const refuse = { ok: false, code: 'not-an-item-list' };
  if (!output || typeof output !== 'object' || output['@type'] !== 'ItemList' || !Array.isArray(output.itemListElement)) return refuse;
  const items = [];
  for (const el of output.itemListElement) {
    const thing = el?.item;
    const type = thing?.['@type']; const id = thing?.identifier; const name = thing?.name;
    if (typeof type !== 'string' || !type || typeof id !== 'string' || !id || typeof name !== 'string' || !name) return refuse;
    const offer = Array.isArray(thing.offers) ? thing.offers[0] : thing.offers;
    items.push({
      label: name,
      detail: typeof thing.description === 'string' && thing.description ? thing.description : null,
      image: typeof thing.image === 'string' && /^https?:\/\//.test(thing.image) ? thing.image : null,
      price: typeof offer?.price === 'string' || typeof offer?.price === 'number' ? String(offer.price) : null,
      seller: typeof offer?.seller?.name === 'string' ? offer.seller.name : null,
      ref: { type, ref: id, ...(source ? { source } : {}) },
    });
  }
  return { ok: true, items };
}

/**
 * A decimal price as given ('1.19', '2,49', '12') in whole cents, by string, never by float arithmetic; null when it
 * is not a plain amount with at most two decimals.
 * @param {string|number} price
 * @returns {number|null}
 */
export function priceCents(price) {
  const m = /^\s*(\d+)(?:[.,](\d{1,2}))?\s*$/.exec(String(price ?? ''));
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}
