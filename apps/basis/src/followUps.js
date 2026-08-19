/**
 * basis — cross-app follow-up registry (v0.4).
 *
 * Per-op follow-ups (`surfaces.chat.followUps`) live IN each
 * app's manifest.  Cross-app chains (`household.addMember` →
 * `folio.share`) live HERE — no single app owns them; basis's
 * runtime decides.
 *
 * The registry shape is intentionally simple:
 *
 *   trigger:    {appOrigin, opId}      — op that just completed
 *   suggestion: {appOrigin, opId,
 *                prefilledArgs?}        — op to suggest next
 *   when?:      (replyPayload) → bool   — optional gate (e.g. only
 *                                         if the trigger reply has
 *                                         a specific shape)
 *
 * Resolution: after a successful dispatch (`reply.error` absent),
 * `collectFollowUps(opId, appOrigin, reply, catalog)` returns the
 * combined list of:
 *   Per-op hints from the catalog (same-app)
 *   - Cross-app chains from this registry whose `trigger` matches
 *
 * Phase v0.4 per `/Project Files/basis/coding-plan.md`.
 */

/**
 * @typedef {object} FollowUpEntry
 * @property {string}  opId
 * @property {object}  [prefilledArgs]
 * @property {string}  [appOrigin]            — when cross-app
 * @property {string}  [label]                — display override
 */

/**
 * @typedef {object} CrossAppChain
 * @property {{appOrigin: string, opId: string}} trigger
 * @property {{appOrigin: string, opId: string, prefilledArgs?: object,
 *             label?: string}} suggestion
 * @property {(reply: object) => boolean} [when]
 */

/**
 * Default cross-app chain registry.  Apps can extend this at runtime
 * via `addCrossAppChain` — but the curated set below covers the
 * common journeys (J3 'Anne is moving in').
 *
 * @type {CrossAppChain[]}
 */
export const DEFAULT_CROSS_APP_CHAINS = [
  // J3 — after household.addMember, suggest sharing a folio folder
  // with the new member.
  {
    trigger:    { appOrigin: 'household', opId: 'addMember' },
    suggestion: {
      appOrigin: 'folio', opId: 'shareFolder',
      prefilledArgs: {},     // 'with' is filled by chat-shell from reply.memberName
      label:         'Share folio folder',
    },
  },
  // J3 — after household.addMember, also suggest adding a stoop post.
  {
    trigger:    { appOrigin: 'household', opId: 'addMember' },
    suggestion: {
      appOrigin: 'stoop', opId: 'postRequest',
      label:         'Post intro on circle',
    },
  },
  // After stoop.postRequest, suggest checking the feed for replies.
  {
    trigger:    { appOrigin: 'stoop', opId: 'postRequest' },
    suggestion: {
      appOrigin: 'stoop', opId: 'listFeed',
      label:         'View feed',
    },
  },
];

/**
 * Build a follow-up resolver bound to a specific cross-app chain
 * registry.  Callers may supply a custom registry (tests + future
 * user-configurable chains); default uses `DEFAULT_CROSS_APP_CHAINS`.
 *
 * @param {object}        [opts]
 * @param {CrossAppChain[]} [opts.chains]
 * @returns {(opId: string, appOrigin: string, reply: object,
 *            catalog: import('./manifestMerge.js').MergedCatalog)
 *           => FollowUpEntry[]}
 */
export function createFollowUpResolver({ chains } = {}) {
  const chainList = Array.isArray(chains) ? chains : DEFAULT_CROSS_APP_CHAINS;

  return function collectFollowUps(opId, appOrigin, reply, catalog) {
    const out = [];

    // (1) Per-op hints (from the catalog's followUpsFor lookup).
    const perOp = catalog?.followUpsFor?.(opId);
    if (Array.isArray(perOp)) {
      for (const hint of perOp) {
        // Per-op hints are same-app by default; appOrigin = trigger's.
        out.push({
          opId:      hint.opId,
          appOrigin: hint.appOrigin ?? appOrigin,
          prefilledArgs: hint.prefilledArgs,
          label:     hint.label,
        });
      }
    }

    // (2) Cross-app chains.
    for (const chain of chainList) {
      if (chain.trigger.appOrigin !== appOrigin) continue;
      if (chain.trigger.opId      !== opId)      continue;
      if (typeof chain.when === 'function' && !chain.when(reply)) continue;
      out.push({
        opId:          chain.suggestion.opId,
        appOrigin:     chain.suggestion.appOrigin,
        prefilledArgs: chain.suggestion.prefilledArgs,
        label:         chain.suggestion.label,
      });
    }

    return dedupe(out);
  };
}

/**
 * Resolve follow-ups using the default registry.  Convenience wrapper.
 *
 * @param {string} opId
 * @param {string} appOrigin
 * @param {object} reply
 * @param {import('./manifestMerge.js').MergedCatalog} catalog
 * @returns {FollowUpEntry[]}
 */
export function collectFollowUps(opId, appOrigin, reply, catalog) {
  return createFollowUpResolver()(opId, appOrigin, reply, catalog);
}

function dedupe(entries) {
  const seen = new Set();
  const out  = [];
  for (const e of entries) {
    const key = `${e.appOrigin}.${e.opId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
