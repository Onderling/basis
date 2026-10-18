/**
 * podPathMap — Tasks' `mem://tasks/circles/<circleId>/…` logical-key ↔
 * canonical storage-function classifier (Tasks M4 / Phase 3.3 parity
 * with Pinboard's `apps/pinboard/src/lib/podPathMap.js`).
 *
 * PURE + reversible. No pod-routing / identity / network here — the
 * attach-time glue (`attachTasksBundle`) composes `classify` + the
 * bundle's `podRouting.resolve()` into the `CachingDataSource`
 * `innerKeyMap`.
 *
 * Design: a logical `mem://` key maps to `{ storageFn, tail }` where
 * `storageFn` is a canonical pod-routing storage-function and `tail`
 * is the resource path within it (each segment percent-encoded by
 * upstream writers — this module passes segments through verbatim,
 * same as Pinboard's convention). `circleId` is injected at classify-time.
 *
 * Tasks logical key space (from ItemStore + per-skill writers):
 *
 *   mem://tasks/circles/<circleId>/          ← itemStore rootContainer
 *     items/<id>.json                     → group/<c>/items
 *     audit/<entry>.json                  → group/<c>/audit
 *     members/<webid>.json                → group/<c>/members
 *     config.json                         → group/<c>/governance
 *     availability/<webid>.json           → group/<c>/availability
 *     skills.json                         → group/<c>/skills
 *     skills/<webid>.json                 → group/<c>/skills
 *     invoicing/<webid>/<month>.json      → group/<c>/invoicing
 *     botAgents/<chatId>.json             → group/<c>/bot-agents
 *     agent/identity-vault.json           → private/state (local-only, but routable)
 *
 *   mem://tasks/settings/…               → intentionally NOT type-routed
 *                                           (device-local; in localOnlyPrefixes)
 *   mem://tasks/process/…                → intentionally NOT type-routed
 *                                           (process-local; never on a pod)
 *
 * Returns `null` for keys that should NOT be pod-routed; the
 * `toInner` closure skips them (SolidPodSource will surface a gap if
 * the app accidentally writes a non-null path that doesn't exist).
 *
 * `reverseResolve` is the inverse: given a pod URI and a pod-routing
 * resolver, returns the canonical `mem://tasks/…` logical key.
 */

// ── Routing table ──────────────────────────────────────────────────
// Each rule: `prefix` = logical prefix (or `exact` for single-path);
// `family` = a stable injective key used by `reverseResolve`;
// `fn(circleId)` = the pod-routing storage-function (same vocabulary
// as Pinboard — the shared `packages/pod-routing` README).
// `circle: true` rules require a circleId at classify-time.

const RULES = [
  // Core task ledger: items/ and audit/ both route to the canonical
  // items / audit storage functions (separate families for bijection).
  {
    family: 't-items',   prefix: 'mem://tasks/circles/',   sub: 'items/',   circle: true,
    fn: (c) => `group/${c}/items`,
  },
  {
    family: 't-audit',   prefix: 'mem://tasks/circles/',   sub: 'audit/',   circle: true,
    fn: (c) => `group/${c}/audit`,
  },
  {
    family: 't-members', prefix: 'mem://tasks/circles/',   sub: 'members/', circle: true,
    fn: (c) => `group/${c}/members`,
  },
  {
    family: 't-gov',     prefix: 'mem://tasks/circles/',   sub: 'config.json', circle: true, exact: true,
    fn: (c) => `group/${c}/governance`,
  },
  {
    family: 't-avail',   prefix: 'mem://tasks/circles/',   sub: 'availability/', circle: true,
    fn: (c) => `group/${c}/availability`,
  },
  {
    family: 't-skills',  prefix: 'mem://tasks/circles/',   sub: 'skills',   circle: true,
    fn: (c) => `group/${c}/skills`,
  },
  {
    family: 't-inv',     prefix: 'mem://tasks/circles/',   sub: 'invoicing/', circle: true,
    fn: (c) => `group/${c}/invoicing`,
  },
  {
    family: 't-bots',    prefix: 'mem://tasks/circles/',   sub: 'botAgents/', circle: true,
    fn: (c) => `group/${c}/bot-agents`,
  },
  // Agent vault — private/state. Per-circle, so circleId prefixes, but
  // the content is not shared: it's the PKCE identity vault. Routable
  // but NOT in localOnlyPrefixes (we want it on the user's own pod).
  {
    family: 't-vault',   prefix: 'mem://tasks/circles/',   sub: 'agent/', circle: true,
    fn: (c) => `group/${c}/private-state`,
  },
];

/**
 * Classify a logical `mem://tasks/…` key into a pod-routing
 * storage-function + tail.
 *
 * @param {string} key   logical `mem://` key
 * @param {object} opts
 * @param {string|null} [opts.circleId]
 * @returns {{ storageFn: string, tail: string } | null}
 */
export function classify(key, { circleId = null } = {}) {
  if (typeof key !== 'string') return null;

  for (const rule of RULES) {
    if (!rule.circle) {
      // Non-circle rules (currently none — placeholder for future).
      if (rule.exact) {
        if (key === rule.prefix + rule.sub) {
          return { storageFn: rule.fn(), tail: '' };
        }
      } else if (key.startsWith(rule.prefix + (rule.sub || ''))) {
        const tail = key.slice((rule.prefix + (rule.sub || '')).length);
        return { storageFn: rule.fn(), tail };
      }
      continue;
    }

    // Circle-prefixed rules: `mem://tasks/circles/<circleId>/<sub>…`
    if (typeof circleId !== 'string' || !circleId) continue;
    const circlePrefix = `${rule.prefix}${circleId}/`;

    if (rule.exact) {
      if (key === circlePrefix + rule.sub) {
        return { storageFn: rule.fn(circleId), tail: '' };
      }
    } else if (key.startsWith(circlePrefix + rule.sub)) {
      const tail = key.slice((circlePrefix + rule.sub).length);
      return { storageFn: rule.fn(circleId), tail };
    }
  }

  // Settings + process keys are intentionally not routed.
  return null;
}

/**
 * Reverse-classify: given a pod URI, map it back to a `mem://tasks/…`
 * logical key.
 *
 * @param {object} args
 * @param {(fn: string, vars: object) => string} args.resolve
 *   `podRouting.resolve` — maps a storage-function to its pod URI
 *   base.
 * @param {string|null} args.circleId
 * @param {string} args.podUri   the pod URI to map back
 * @param {object} [args.vars]   pod-routing vars (e.g. anchor)
 * @returns {string|null}  `mem://` logical key, or null if not
 *   recognisable.
 */
export function reverseResolve({ resolve, circleId, podUri, vars = {} }) {
  if (typeof podUri !== 'string' || !podUri) return null;

  for (const rule of RULES) {
    if (!rule.circle) continue;
    if (typeof circleId !== 'string' || !circleId) continue;

    const base = resolve(rule.fn(circleId), vars);
    if (typeof base !== 'string' || base.length === 0) continue;

    const prefix = base.endsWith('/') ? base : `${base}/`;
    if (!podUri.startsWith(prefix)) continue;

    const tail = podUri.slice(prefix.length);
    const circlePrefix = `mem://tasks/circles/${circleId}/`;

    if (rule.exact) {
      return circlePrefix + rule.sub;
    }
    return circlePrefix + rule.sub + tail;
  }

  return null;
}
