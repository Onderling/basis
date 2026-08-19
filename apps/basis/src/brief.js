/**
 * basis — `/brief` aggregator (v0.7).
 *
 * Fans out across all enabled apps declaring `surfaces.chat.brief`
 * ; calls each app's `summarySkill`; aggregates replies into a
 * `'brief'`-shape reply with one section per app.
 *
 * Empty-section handling (per design doc): apps that return null /
 * `{ok: false}` / no items are skipped — the brief shows only
 * sections with content. Apps that don't declare don't appear.
 *
 * Caching (per OQ-7.A user resolution): in-memory 60s cache; an
 * explicit `[Refresh]` button (rendered by the brief renderer)
 * bypasses.  Longer TTL for pod-less mode lands when that mode
 * actually exists.
 *
 * Phase v0.7 per `/Project Files/basis/coding-plan.md`.
 *
 * Platform: neutral.
 */
import { param, PARAM_SCOPE, PARAM_KIND } from '@onderling/item-store';

// Parameter register (#36) — brief cache TTL (scope:device, kind:internal). Caller-overridable via opts.ttlMs.
const DEFAULT_CACHE_TTL_MS = param({ key: 'brief.cacheTtlMs', scope: PARAM_SCOPE.DEVICE, kind: PARAM_KIND.INTERNAL, default: 60_000 });

/**
 * @typedef {object} BriefSection
 * @property {string}  appOrigin
 * @property {string}  label
 * @property {number}  order
 * @property {*}       payload    — opaque to the aggregator; DOM
 *                                  adapter renders it (text / list /
 *                                  count / etc. per the brief skill's
 *                                  reply shape).
 * @property {string}  [error]    when the summary skill failed
 */

/**
 * @typedef {object} BriefReply
 * @property {BriefSection[]} sections
 * @property {number}          generatedAt   epoch ms
 * @property {string}          [cacheKey]    for [Refresh] bypass
 */

/**
 * Run the /brief fan-out.
 *
 * @param {object} args
 * @param {import('./manifestMerge.js').MergedCatalogue} args.catalogue
 * @param {(appOrigin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {object}  [args.cache]            optional cache instance
 * @param {boolean} [args.bypassCache]      true → ignore cached result
 * @returns {Promise<BriefReply>}
 */
export async function runBrief({ catalogue, callSkill, cache, bypassCache }) {
  if (!catalogue || typeof catalogue.briefAggregations !== 'function') {
    throw new TypeError('runBrief: catalogue with briefAggregations required');
  }
  if (typeof callSkill !== 'function') {
    throw new TypeError('runBrief: callSkill required');
  }

  if (cache && !bypassCache) {
    const cached = cache.get();
    if (cached) return cached;
  }

  const decls = catalogue.briefAggregations();
  // Fan out in parallel — apps shouldn't block each other.
  const results = await Promise.all(decls.map(async (decl) => {
    try {
      const payload = await callSkill(decl.appOrigin, decl.summarySkill, {});
      // Skip empty replies: ok:false / null / undefined / empty
      // {items: []} / empty {message: ''}.
      if (isEmpty(payload)) return null;
      return /** @type {BriefSection} */ ({
        appOrigin: decl.appOrigin,
        label:     decl.label ?? decl.appOrigin,
        order:     decl.order ?? 999,
        payload,
      });
    } catch (err) {
      return {
        appOrigin: decl.appOrigin,
        label:     decl.label ?? decl.appOrigin,
        order:     decl.order ?? 999,
        payload:   null,
        error:     err?.message ?? String(err),
      };
    }
  }));

  const sections = results
    .filter(Boolean)
    .sort((a, b) => a.order - b.order);

  const reply = {
    sections,
    generatedAt: Date.now(),
    cacheKey:    Math.random().toString(36).slice(2, 10),
    // A3 follow-up (2026-05-27 user real-device test) — when every
    // app declared a brief but had nothing to brief about (empty
    // tasks/posts/files/events), expose a friendly aggregate-empty
    // hint so the renderer can show *something* instead of a blank
    // bubble.  Renderers consult `emptyMessage` first.
    ...(sections.length === 0
      ? { emptyMessage: 'Nothing to brief today.' }
      : {}),
  };

  if (cache && !bypassCache) cache.set(reply);
  return reply;
}

function isEmpty(payload) {
  if (payload === null || payload === undefined) return true;
  if (typeof payload === 'object') {
    if (payload.ok === false) return true;
    if (Array.isArray(payload.items) && payload.items.length === 0) return true;
    if (typeof payload.message === 'string' && payload.message.trim() === '') return true;
    // Object with only ok:true and nothing else → empty.
    const keys = Object.keys(payload);
    if (keys.length === 0) return true;
    if (keys.length === 1 && keys[0] === 'ok' && payload.ok === true) return true;
  }
  return false;
}

/**
 * In-memory cache for brief replies.  TTL-based; per OQ-7.A.
 *
 * @param {object} [opts]
 * @param {number} [opts.ttlMs=60_000]
 * @param {() => number} [opts.now=Date.now]
 */
export function createBriefCache(opts = {}) {
  const ttl = typeof opts.ttlMs === 'number' ? opts.ttlMs : DEFAULT_CACHE_TTL_MS;
  const now = typeof opts.now === 'function' ? opts.now : Date.now;
  /** @type {{reply: BriefReply, expiresAt: number} | null} */
  let entry = null;
  return {
    get() {
      if (!entry) return null;
      if (now() > entry.expiresAt) { entry = null; return null; }
      return entry.reply;
    },
    set(reply) {
      entry = { reply, expiresAt: now() + ttl };
    },
    clear() { entry = null; },
    get cached() { return entry?.reply ?? null; },
    get ttlMs() { return ttl; },
  };
}
