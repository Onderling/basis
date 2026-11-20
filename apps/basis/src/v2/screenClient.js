/**
 * THE SCREEN CLIENT (ledger L1035; the first step of L1037): what a toolbox's own
 * page imports to be a connected screen of a household bot. It is the web app's screen shell (`web/v2/screenShell.js`)
 * without the paint: `createScreenView` (all of a screen's logic) over a browser agent, plus what a page outside the app
 * needs and the app's own shell does not: one code for every refusal, a state to await, sign-out, pairing in steps,
 * storage under a name per toolbox, abort and time-out per call. Built into ONE ESM file by
 * `scripts/build-screen-client.mjs`; nothing here runs at import.
 *
 * A page opened from disk has no link to the bot: it is given the bot's screen START link once (`bot`, the address a
 * screen opens to make its own connect code: the admin's `/scherm`), pairs by the paste route (`startPairing` → the
 * person pastes `paste` into their own chat with the bot → `waitForGrant`), and from then on resumes from what this
 * browser kept.
 */
import { createScreenView, screenAddressFor } from './screenView.js';
import { parseScreenStartLink } from './botScreens.js';
import { isKeyUnreadable } from '../core/agent/keyUnreadable.js';
import { SCREEN_PAIRING_TTL_MS } from './screenDoor.js';
import { createSecureAgent, makeBrowserVault } from '@onderling/secure-agent';

/** The client's version: the page can say which one it was built against. */
export const SCREEN_CLIENT_VERSION = '0.1.0';

/**
 * Every refusal's code. `grant-expired` is ONE code for a grant that ran out AND one that was taken away (`/schermen los`,
 * a pairing elsewhere): the page does the same for both, pair again.
 */
export const SCREEN_CLIENT_CODES = Object.freeze([
  'not-paired', 'grant-expired', 'rate-limited', 'no-connection', 'timeout', 'aborted', 'op-not-allowed',
  'toolbox-unreachable', 'toolbox-not-yours', 'answer-too-large', 'tool-error', 'not-found', 'failed',
  // this page's own key in this browser is there but will not read (L1115): never replaced on its own; `signOut()`
  // removes it, then pair again
  'key-unreadable',
]);

/** How long a call waits without its own `timeoutMs`. */
export const SCREEN_CALL_TIMEOUT_MS = 30_000;

/** A toolbox's own codes, folded to the client's (the page does the same for each in a group). */
const TOOLBOX_CODES = Object.freeze({
  'toolbox-unreachable': 'toolbox-unreachable', 'toolbox-timeout': 'toolbox-unreachable', 'toolbox-error': 'toolbox-unreachable',
  'toolbox-unauthorized': 'toolbox-unreachable', 'toolbox-no-endpoint': 'toolbox-unreachable', 'toolbox-bad-answer': 'toolbox-unreachable',
  'toolbox-off': 'toolbox-unreachable', 'toolbox-not-placed': 'toolbox-unreachable', 'toolbox-no-key': 'toolbox-unreachable',
});

/**
 * The client's code for what a call threw or answered: the ONE table (the notes list what each case produced in a run).
 * @param {unknown} err  a thrown error, or null
 * @param {object|null} [answer]  the op's answer, when it answered
 * @returns {string|null}  null for an answer that is no refusal
 */
export function screenClientCode(err, answer = null) {
  if (err) {
    if (isKeyUnreadable(err)) return 'key-unreadable';
    const m = String(err?.code ?? err?.message ?? err);
    if (/aborted|AbortError/i.test(m)) return 'aborted';
    if (/rate-limited|RATE_LIMIT/i.test(m)) return 'rate-limited';
    if (/revoked|INVALID_TOKEN|TOKEN_EXPIRED|expired|not-bound/i.test(m)) return 'grant-expired';
    if (/timed?[- ]?out|TIMEOUT/i.test(m)) return 'timeout';
    if (/not connected|no relay|connect|WebSocket|ECONN|offline/i.test(m)) return 'no-connection';
    if (/no grant for|UNKNOWN_SKILL|not allowed/i.test(m)) return 'op-not-allowed';
    return 'failed';
  }
  if (!answer || typeof answer !== 'object' || answer.ok !== false) return null;
  const c = String(answer.code ?? answer.error?.code ?? answer.reason ?? '');
  if (SCREEN_CLIENT_CODES.includes(c)) return c;
  if (TOOLBOX_CODES[c]) return TOOLBOX_CODES[c];
  if (/rate-limited/.test(c)) return 'rate-limited';
  return 'failed';
}

/** Storage under a name per toolbox: every key this client writes starts with it, so sign-out can wipe exactly them. */
function prefixed(storage, prefix) {
  return {
    getItem: (k) => storage?.getItem?.(prefix + k) ?? null,
    setItem: (k, v) => storage?.setItem?.(prefix + k, v),
    removeItem: (k) => storage?.removeItem?.(prefix + k),
  };
}

/**
 * A screen client for one toolbox's page. Nothing runs until a method is called.
 * @param {object} a
 * @param {string} a.toolbox  the toolbox this page belongs to (the bot pairs it for that toolbox only)
 * @param {string} a.bot      the bot's screen start link (`…#scherm-start=…`), given once
 * @param {string} [a.label]  how the person's chat names this page ('boodschappen op de laptop')
 * @param {Storage} [a.storage]  where the grant and the key are kept (default: this browser's localStorage)
 * @param {(o: {vaultPrefix: string}) => Promise<object>} [a.makeAgent]  the browser agent (default: a relay secure agent)
 * @param {Function} [a.createView]  for tests: the view factory (default `createScreenView`)
 * @param {() => number} [a.now]
 */
export function createScreenClient({ toolbox, bot, label = null, storage = globalThis.localStorage, makeAgent = null, createView = createScreenView, now = () => Date.now() } = {}) {
  if (typeof toolbox !== 'string' || !toolbox.trim()) throw new TypeError('createScreenClient: toolbox (its name) required');
  const name = toolbox.trim();
  const start = parseScreenStartLink(String(bot ?? ''));
  const keyPrefix = `onderling.screen.${name}.`;
  const vaultPrefix = `onderling-screen:${name}:`;
  const store = prefixed(storage, keyPrefix);
  // made when a pairing or a resume starts, never at import: the key lives under this toolbox's own name
  const agentFor = makeAgent ?? (async () => createSecureAgent({ vault: makeBrowserVault(vaultPrefix), transportMode: 'relay', warnOnInsecure: false }));
  const makeAgentNow = () => agentFor({ vaultPrefix });

  let view = null;
  let mode = null;   // 'pair' | 'resume'
  let current = 'not-paired';
  let inFlight = 0;
  const listeners = new Set();
  const setState = (s) => {
    if (s === current) return;
    current = s;
    for (const fn of listeners) { try { fn(s); } catch { /* a listener's fault is its own */ } }
  };
  const kept = () => (start.ok ? store.getItem(`onderling.screen.${start.botAddress}`) : null);
  // the view for what this browser has: a kept grant resumes, else the start link pairs
  const viewFor = (wanted) => {
    if (view && mode === wanted) return view;
    const link = wanted === 'resume' ? `x${screenAddressFor(start.botAddress)}` : String(bot);
    view = createView({ link, makeAgent: makeAgentNow, storage: store });
    mode = wanted;
    return view;
  };

  return {
    version: SCREEN_CLIENT_VERSION,
    toolbox: name,

    /** `not-paired` · `connected` · `busy` (a call in flight) · `broken` (the last call found no connection). */
    state: () => current,
    /** Hear every change of state; returns the unsubscribe. */
    onState(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /** Resolves when the state is `s` (at once if it is); rejects with `aborted` on the signal. */
    whenState(s, { signal } = {}) {
      if (current === s) return Promise.resolve(s);
      return new Promise((resolve, reject) => {
        // the abort listener goes when this settles: a page that reuses one signal does not pile them up
        const onAbort = () => { off(); reject(Object.assign(new Error('aborted'), { code: 'aborted' })); };
        const off0 = this.onState((now2) => { if (now2 === s) { off(); resolve(s); } });
        const off = () => { off0(); signal?.removeEventListener?.('abort', onAbort); };
        signal?.addEventListener?.('abort', onAbort, { once: true });
      });
    },

    /**
     * Back on the relay with what this browser kept, without pairing again. `{ok: true}`, or `{ok: false, code}`:
     * `not-paired` when nothing is kept here ("pair again": storage of a page opened from disk may not survive).
     */
    async resume() {
      if (!start.ok) return { ok: false, code: 'not-paired', reason: 'no-bot-link' };
      if (!kept()) { setState('not-paired'); return { ok: false, code: 'not-paired' }; }
      try {
        const ok = await viewFor('resume').resume();
        if (!ok) { setState('not-paired'); return { ok: false, code: 'not-paired' }; }
        setState('connected');
        return { ok: true };
      } catch (e) { setState('broken'); return { ok: false, code: screenClientCode(e) }; }
    },

    /**
     * Pairing, step one: `{paste, code, expiresAt}`. `paste` is what the person pastes into their own chat with the bot
     * (`/koppel-scherm …`); `code` the four characters this page shows for the bot's which-code question; `expiresAt`
     * when the ten minutes end.
     */
    async startPairing() {
      if (!start.ok) throw Object.assign(new Error('createScreenClient: bot is not a screen start link'), { code: 'not-paired' });
      view = null;
      const r = await viewFor('pair').connect({ label: label ?? name, toolbox: name });
      return { paste: `/koppel-scherm ${r.offer}`, code: r.code, expiresAt: now() + SCREEN_PAIRING_TTL_MS };
    },

    /** Pairing, step two: `granted` · `refused` · `expired` (or `aborted` on the signal). */
    async waitForGrant({ signal } = {}) {
      if (!view || mode !== 'pair') return 'expired';
      const aborted = new Promise((resolve) => signal?.addEventListener?.('abort', () => resolve('aborted'), { once: true }));
      const outcome = await Promise.race([
        view.granted().then(() => 'granted', (e) => (/refused/.test(String(e?.message)) ? 'refused' : 'expired')),
        aborted,
      ]);
      if (outcome === 'granted') setState('connected');
      return outcome;
    },

    /** The ops this screen may call (`app.op`), as its grant says. */
    ops: () => (view ? view.ops() : []),

    /** Hear that something the screen reads changed (the bot's nudge; it names nothing: read again). */
    onNudge(fn) { return view ? view.onNudge(fn) : () => {}; },

    /**
     * Call one of the bot's ops as the person. Resolves with the op's answer, or `{ok: false, code, …}`; never throws.
     * Calls may run at once; the bot's budget (3 a second, a burst of 60, per screen) answers `rate-limited` past it.
     * @param {string} op  `app.op`
     * @param {object} [input]
     * @param {{signal?: AbortSignal, timeoutMs?: number}} [o]
     */
    async call(op, input = {}, { signal, timeoutMs = SCREEN_CALL_TIMEOUT_MS } = {}) {
      if (!view || current === 'not-paired') return { ok: false, code: 'not-paired' };
      if (!view.ops().includes(op)) return { ok: false, code: 'op-not-allowed' };
      if (signal?.aborted) return { ok: false, code: 'aborted' };
      inFlight += 1;
      setState('busy');
      let timer = null;
      let onAbort = null;
      let after = 'connected';   // what the screen is once no call is in flight
      try {
        const answer = await Promise.race([
          view.call(op, input),
          new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'timeout' })), timeoutMs); }),
          new Promise((_, reject) => { onAbort = () => reject(Object.assign(new Error('aborted'), { code: 'aborted' })); signal?.addEventListener?.('abort', onAbort, { once: true }); }),
        ]);
        const code = screenClientCode(null, answer);
        return code ? { ...answer, ok: false, code } : answer;
      } catch (e) {
        const code = screenClientCode(e);
        // no connection: broken until a call gets through again (the agent reconnects by itself; the page waits);
        // a grant that ran out or was taken away: not paired (pair again)
        after = code === 'no-connection' ? 'broken' : code === 'grant-expired' ? 'not-paired' : 'connected';
        return { ok: false, code, message: String(e?.message ?? e) };
      } finally {
        if (timer) clearTimeout(timer);
        // the abort listener goes when the call settles: a page that reuses one signal does not pile them up
        if (onAbort) signal?.removeEventListener?.('abort', onAbort);
        inFlight = Math.max(0, inFlight - 1);
        if (after !== 'connected') setState(after);
        else if (inFlight === 0 && current === 'busy') setState('connected');
      }
    },

    /** Sign out: this toolbox's grant and key leave this browser; the relay is let go. */
    async signOut() {
      try { await view?.stop?.(); } catch { /* gone either way */ }
      view = null; mode = null;
      try {
        const keys = [];
        for (let i = 0; i < (storage?.length ?? 0); i += 1) { const k = storage.key(i); if (k && (k.startsWith(keyPrefix) || k.startsWith(vaultPrefix))) keys.push(k); }
        for (const k of keys) storage.removeItem(k);
      } catch { /* a storage that cannot list: the grant key at least */ try { store.removeItem(`onderling.screen.${start.botAddress}`); } catch { /* nothing kept */ } }
      setState('not-paired');
      return { ok: true };
    },
  };
}
