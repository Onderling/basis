import { storageName } from './v2/storageRegister.js';   // every storage name from the one register
/**
 * basis — external-flow primitive (J6).
 *
 * Per design choice F.1 + OQ-1.A: some skills (OIDC sign-in being
 * the canonical case) require the user to leave the chat tab,
 * complete a flow on an external page, and come back.  This module
 * provides the framework:
 *
 *   1. `openExternalFlow({url, threadId, opId, prefilledArgs?})` —
 *      generates a stable `sessionId`, persists in-flight state to
 *      IndexedDB (so it survives the page reload OIDC may cause),
 *      registers a callback with the EventRouter, and navigates to
 *      `url` (with `sessionId` appended as a query param so the
 *      remote side can echo it back on the callback).
 *
 *   2. `setupDeepLinkReceiver({eventRouter, threadStore, idb})` —
 *      runs on app boot; checks the URL hash / query for a
 *      `?cc-callback=<sessionId>&...` fragment; if present, looks
 *      up the persisted in-flight state and delivers a synthesised
 *      event with `correlationId === sessionId` so EventRouter's
 *      `registerInFlight` machinery wakes the waiting thread.
 *
 * Real OIDC binding (Inrupt's browser-side authn) lives behind a
 * thin adapter — v0.6.2 ships the framework with a MOCK external
 * URL (basis's own /mock-oidc page) so the round-trip is
 * demonstrable without a real Solid pod.
 *
 * Platform: neutral (no DOM imports).  Caller (web/main.js) wires
 * `window.location` + IndexedDB; RN parallel reads from a custom
 * URL scheme.
 *
 * Phase v0.6 per `/Project Files/basis/coding-plan.md`.
 */

const IN_FLIGHT_STORE_KEY = storageName('inFlightFlows');

/**
 * @typedef {object} InFlightFlow
 * @property {string} sessionId
 * @property {string} threadId
 * @property {string} opId
 * @property {object} [prefilledArgs]
 * @property {number} startedAt          epoch ms
 * @property {string} purpose            human-readable label for diagnostics
 */

/**
 * Generate a stable sessionId.  Crypto-RNG if available; falls back
 * to a Date-+ Math.random combo (acceptable for J6 — sessionIds
 * just need to be unique within a workspace).
 *
 * @returns {string}
 */
export function generateSessionId() {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
    return `cc-${globalThis.crypto.randomUUID()}`;
  }
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `cc-${time}-${rand}`;
}

/**
 * Open an external flow.  Persists in-flight state + registers
 * EventRouter callback + navigates.
 *
 * @param {object} args
 * @param {string} args.url                URL to navigate to (the
 *                                          {sessionId} placeholder
 *                                          is replaced with the
 *                                          generated id; otherwise
 *                                          appended as ?cc-session=)
 * @param {string} args.threadId
 * @param {string} args.opId               originating op (for resume)
 * @param {object} [args.prefilledArgs]
 * @param {string} [args.purpose='signin'] human-readable diagnostic label
 * @param {import('./events.js').EventRouter} args.eventRouter
 * @param {(event: object) => void}        args.onCallback
 * @param {(flow: InFlightFlow) => Promise<void>} args.persistFlow
 *   IndexedDB writer — passed in by caller (web/main.js) so this
 *   module stays platform-neutral.
 * @param {(href: string) => void}         [args.navigate]
 *   Defaults to `globalThis.location.assign(href)`.  Override for
 *   tests + SPA routers.
 * @returns {Promise<{ sessionId: string, flow: InFlightFlow, href: string }>}
 */
export async function openExternalFlow(args) {
  const {
    url, threadId, opId, prefilledArgs,
    purpose = 'external-flow',
    eventRouter, onCallback,
    persistFlow,
    navigate,
  } = args ?? {};

  if (typeof url       !== 'string' || url === '')      throw new TypeError('openExternalFlow: url required');
  if (typeof threadId  !== 'string' || threadId === '') throw new TypeError('openExternalFlow: threadId required');
  if (typeof opId      !== 'string' || opId === '')     throw new TypeError('openExternalFlow: opId required');
  if (!eventRouter || typeof eventRouter.registerInFlight !== 'function') {
    throw new TypeError('openExternalFlow: eventRouter with registerInFlight required');
  }
  if (typeof onCallback !== 'function') {
    throw new TypeError('openExternalFlow: onCallback required');
  }
  if (typeof persistFlow !== 'function') {
    throw new TypeError('openExternalFlow: persistFlow required');
  }

  const sessionId = generateSessionId();
  /** @type {InFlightFlow} */
  const flow = {
    sessionId, threadId, opId,
    ...(prefilledArgs ? { prefilledArgs } : {}),
    startedAt: Date.now(),
    purpose,
  };

  // Persist BEFORE navigating — the page may unload immediately.
  await persistFlow(flow);

  // Register callback with EventRouter.  When the deep-link
  // receiver delivers the matching event, this fires + the thread
  // resumes.  (In real OIDC redirect the JS process may have been
  // reloaded; the receiver re-registers from persisted state on
  // boot — see resumeInFlightFlows.)
  eventRouter.registerInFlight(sessionId, onCallback, { threadId });

  // Build the destination URL.  Two patterns supported:
  //   - URL contains '{sessionId}' literal → substitute
  //   - Otherwise append ?cc-session=<sessionId> (preserves existing query)
  let href;
  if (url.includes('{sessionId}')) {
    href = url.replace(/\{sessionId\}/g, encodeURIComponent(sessionId));
  } else {
    const sep = url.includes('?') ? '&' : '?';
    href = `${url}${sep}cc-session=${encodeURIComponent(sessionId)}`;
  }

  // Navigate.
  if (typeof navigate === 'function') {
    navigate(href);
  } else if (typeof globalThis !== 'undefined' && globalThis.location) {
    globalThis.location.assign(href);
  }

  return { sessionId, flow, href };
}

/**
 * Parse callback parameters from a URL string.  Accepts both
 * basis's own callback shape (`?cc-callback=<sessionId>&...`)
 * AND the OIDC standard shape (`#code=...&state=<sessionId>`).
 *
 * @param {string | URL | Location} source
 * @returns {{ sessionId: string, params: Object<string, string> } | null}
 */
export function parseCallbackUrl(source) {
  const url = toUrl(source);
  if (!url) return null;
  // Pattern 1: basis own callback (?cc-callback=<id>).
  const ccCallback = url.searchParams.get('cc-callback');
  const ccSession  = url.searchParams.get('cc-session');
  if (ccCallback) {
    const params = {};
    for (const [k, v] of url.searchParams.entries()) params[k] = v;
    return { sessionId: ccCallback, params };
  }
  // Pattern 2: OIDC standard — `state` carries our sessionId,
  // `code` carries the auth code.  Often in the hash fragment.
  const hash = url.hash?.startsWith('#') ? url.hash.slice(1) : '';
  const hashParams = new URLSearchParams(hash);
  const oidcState  = hashParams.get('state');
  const oidcCode   = hashParams.get('code');
  if (oidcState && oidcCode) {
    const params = { code: oidcCode };
    for (const [k, v] of hashParams.entries()) params[k] = v;
    return { sessionId: oidcState, params };
  }
  // Pattern 3: bare cc-session (resume after page reload, no payload)
  if (ccSession) {
    const params = {};
    for (const [k, v] of url.searchParams.entries()) params[k] = v;
    return { sessionId: ccSession, params };
  }
  return null;
}

/**
 * Resume in-flight flows on boot.  Called by the deep-link
 * receiver: reads persisted state, re-registers the EventRouter
 * callbacks (the page reloaded and lost them), and — if the
 * current URL carries a callback fragment — fires the matching
 * one immediately.
 *
 * @param {object} args
 * @param {InFlightFlow[]}                         args.persisted
 * @param {import('./events.js').EventRouter}      args.eventRouter
 * @param {(flow: InFlightFlow, params: object) => void} args.onCallback
 * @param {{ sessionId: string, params: object } | null} [args.callback]
 *   Parsed callback from parseCallbackUrl, if any.
 * @returns {{ fired: InFlightFlow | null, remaining: InFlightFlow[] }}
 */
export function resumeInFlightFlows({ persisted, eventRouter, onCallback, callback }) {
  if (!Array.isArray(persisted)) return { fired: null, remaining: [] };
  let fired = null;
  const remaining = [];
  for (const flow of persisted) {
    if (callback && flow.sessionId === callback.sessionId) {
      // Fire NOW — the page is in the callback state.
      try { onCallback(flow, callback.params ?? {}); }
      catch { /* swallow */ }
      fired = flow;
      continue;
    }
    // Re-register: the thread is still waiting; an event with this
    // sessionId could arrive later (e.g. another tab finishes the
    // flow).
    eventRouter.registerInFlight(flow.sessionId, (event) => {
      onCallback(flow, event?.payload ?? {});
    }, { threadId: flow.threadId });
    remaining.push(flow);
  }
  return { fired, remaining };
}

/* ─── internals ─────────────────────────────────────────── */

function toUrl(source) {
  if (!source) return null;
  if (typeof source === 'string') {
    try { return new URL(source, 'http://localhost'); } catch { return null; }
  }
  if (typeof source === 'object' && 'searchParams' in source && 'hash' in source) {
    return source;
  }
  if (typeof source === 'object' && 'href' in source) {
    try { return new URL(source.href); } catch { return null; }
  }
  return null;
}

/**
 * Exposed for tests + caller convenience.
 */
export { IN_FLIGHT_STORE_KEY };
