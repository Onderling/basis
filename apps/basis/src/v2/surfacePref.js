/**
 * surfacePref — S6.C: the preference layer that PICKS which projection a bot
 * reply renders. The manifest declares an op's surfaces (inline buttons +/or a
 * screen); this chooses among them per the user's interaction preference — the
 * "all three, by preference" selector (CLAUDE.md "one manifest, every surface" +
 * a chooser; cf. [[project-ai-as-interface-direction]] per-user mini-menus vs
 * AI-assist vs a screen).
 *
 *   inline  (default) — show the screen button (if any) + the per-item inline
 *                       buttons. The "menu in the chat" the user remembered.
 *   screen            — prefer the overview screen; suppress per-item buttons
 *                       when a screen exists (cleaner, screen-first). Falls back
 *                       to inline buttons when the op has no screen.
 *   minimal           — text only; no buttons (let typing / AI-assist drive).
 *
 * Pure + a tiny pluggable store, so it's unit-testable + shared web↔mobile.
 */

// 'chat' is the conversational projection: no fixed buttons — you talk to the bot,
// which is *potentially enriched by an LLM* (the user can load one that powers all
// in-app chat; a circle may forbid it — see chatAi.js). It subsumes the old bare
// "minimal" (chat with no LLM available degrades to plain text replies).
export const SURFACE_PREFS = Object.freeze(['inline', 'screen', 'chat']);
export const DEFAULT_SURFACE_PREF = 'inline';

/** Normalize an arbitrary value to a known preference. */
export function normalizeSurfacePref(value) {
  return SURFACE_PREFS.includes(value) ? value : DEFAULT_SURFACE_PREF;
}

/**
 * Choose the buttons to render for a reply, given the user's preference.
 *
 * @param {object} args
 * @param {Array}  [args.inlineButtons]  per-item dispatch buttons (S6.A)
 * @param {Array}  [args.screenButton]   0..1 open-screen button (S6.B)
 * @param {string} [args.pref]           'inline' | 'screen' | 'chat'
 * @returns {Array} the buttons to put on payload.buttons
 */
export function selectSurfaceButtons({ inlineButtons = [], screenButton = [], pref } = {}) {
  const p = normalizeSurfacePref(pref);
  if (p === 'chat') return [];   // conversational — no fixed buttons; the bot guides you (LLM-enriched when available)
  if (p === 'screen') return screenButton.length ? [...screenButton] : [...inlineButtons];
  return [...screenButton, ...inlineButtons];   // inline (default)
}

/**
 * A tiny preference store over an injectable io (`{get, set}` of a string).
 * Web passes a localStorage io; mobile an AsyncStorage io. Synchronous get with
 * a cached value + async hydrate keeps the dispatch path non-blocking.
 */
export function createSurfacePrefStore(io = {}) {
  let cached = DEFAULT_SURFACE_PREF;
  return {
    /** Current preference (cached; call hydrate() once at boot to load). */
    get: () => cached,
    /** Load from the backing io (best-effort). */
    async hydrate() {
      try { cached = normalizeSurfacePref(await io.get?.()); } catch { /* keep default */ }
      return cached;
    },
    /** Persist + update the cache. */
    async set(value) {
      cached = normalizeSurfacePref(value);
      try { await io.set?.(cached); } catch { /* best-effort */ }
      return cached;
    },
  };
}

/** The register param this preference lives in since the device-params consolidation. */
export const SURFACE_PREF_PARAM_KEY = 'surface.pref';

/**
 * Register-backed io (the device-params consolidation): the value lives in the parameter
 * register — reads mirror the live register value, writes go through the ONE kind-gated
 * set-param. `getAgent` is a thunk because both shells construct the store at module scope,
 * before the agent boots; `hydrate()` runs post-boot, when the thunk resolves.
 */
export function registerSurfacePrefIo(getAgent, key = SURFACE_PREF_PARAM_KEY) {
  return {
    get: async () => getAgent?.()?.getParamValue?.(key) ?? null,
    set: async (v) => {
      const agent = getAgent?.();
      if (agent) await agent.callSkill('params', 'set-param', { key, value: v });
    },
  };
}
