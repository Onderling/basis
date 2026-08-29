/**
 * The per-kind "tell me" setting for the lines the conversation RENDERS from the log (membership and
 * governance notices) — decision 4, 2026-08-29: the circle's admin sets a default per kind, and any member
 * overrides it privately per circle. Nothing here writes a notice; it only answers `wants(kind)` for the
 * projections (`membershipNotices.js`, `governanceNotices.js`) and hands the settings screens their rows.
 *
 *   admin default  → `policy.notices`   (circle policy, `normalizeNotices`)
 *   private choice → `override.notices` (the member's per-circle override — partial: only the kinds they touched)
 *   effective      → override ?? policy ?? true
 */
/**
 * Every notice kind a projection can produce — the ONE list the settings offer. A literal, not derived
 * from the projections' key tables: `circlePolicy.js` imports this module for its defaults, and the
 * projections sit downstream of the policy, so deriving here would be a cycle that evaluates to
 * `undefined` at load. `noticeSettings.test.js` pins that this list and the projections' keys agree.
 */
export const NOTICE_KINDS = Object.freeze(['removed', 'promoted', 'demoted', 'joined', 'decisionOpened']);

/** A wording variant tells the same thing as its base kind and follows its setting. */
const BASE_KIND = Object.freeze({ removedWithReason: 'removed' });

export const DEFAULT_NOTICES = Object.freeze(Object.fromEntries(NOTICE_KINDS.map((k) => [k, true])));

/** Coerce a stored (partial) map into a complete one — unknown kinds dropped, non-booleans → default. */
export function normalizeNotices(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return Object.freeze(Object.fromEntries(NOTICE_KINDS.map((k) => [k, typeof src[k] === 'boolean' ? src[k] : true])));
}

/** A member's PARTIAL override: only the kinds they explicitly set survive. */
export function normalizeNoticeOverride(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const k of NOTICE_KINDS) if (typeof src[k] === 'boolean') out[k] = src[k];
  return Object.freeze(out);
}

/** Does THIS viewer want to see `kind` in THIS circle's conversation? */
export function wantsNotice(kind, { policy = null, override = null } = {}) {
  const base = BASE_KIND[kind] ?? kind;
  const mine = override?.notices?.[base];
  if (typeof mine === 'boolean') return mine;
  const dflt = policy?.notices?.[base];
  return typeof dflt === 'boolean' ? dflt : true;
}

/** The predicate a shell hands to `chatRows({ wants })`. */
export function noticeWants({ policy = null, override = null } = {}) {
  return (kind) => wantsNotice(kind, { policy, override });
}

/**
 * Rows for the admin's per-kind control (same shape as `conversationKindsRows`: `on` and the NEXT policy
 * value for the field when tapped), so both shells paint one row model and neither can compute a
 * different next map.
 */
export function noticeRows({ circleSetting = null } = {}) {
  const current = normalizeNotices(circleSetting);
  return NOTICE_KINDS.map((kind) => ({
    kind,
    labelKey: `circle.notices.${kind}`,
    on: current[kind],
    next: { ...current, [kind]: !current[kind] },
  }));
}

/** Rows for a MEMBER's private override — `on` is the effective answer, `next` the override patch. */
export function noticeOverrideRows({ policy = null, override = null } = {}) {
  return NOTICE_KINDS.map((kind) => {
    const on = wantsNotice(kind, { policy, override });
    return { kind, labelKey: `circle.notices.${kind}`, on, next: { [kind]: !on } };
  });
}
