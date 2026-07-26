/**
 * basis v2 — circle policy + member override model (shared, F2).
 *
 * A circle's settings are a small record keyed by circleId (: the
 * five axes) plus a per-member override record. This module is
 * the pure model: defaults, enum validation, normalisation (merge a
 * stored partial onto defaults), and deep-merge for edits. Persistence
 * (pod `shared.json` per the cross-app-settings convention) is wired by
 * the host on top — kept out of here so it stays unit-testable + portable.
 */

export const CIRCLE_FEATURES = [
  'chat', 'noticeboard', 'tasks', 'lists', 'calendar', 'notes', 'houseRules', 'memberDirectory',
];

// Connectivity Phase 4 §5 (L4) — the governed actions + their decision-classes.
// Each governed action maps to WHO may resolve it. "An admin removed someone" and
// "the circle voted someone out" are the SAME action under different classes — not two
// features. The tally + threshold live in governanceDecision.js (this file only holds
// the policy shape). See docs/decisions.md (2026-07-25).
export const GOVERNANCE_ACTIONS = ['removeMember', 'rotateKey', 'changeRule', 'changePolicy'];
export const GOVERNANCE_CLASSES = ['any-admin', 'admin-quorum', 'member-vote'];
// Defaults: the mechanical/safety actions are an admin's call; rule/policy changes want
// admin agreement; member-vote is opt-in per circle for any action.
export const DEFAULT_GOVERNANCE = {
  removeMember: 'any-admin',
  rotateKey:    'any-admin',
  changeRule:   'admin-quorum',
  changePolicy: 'admin-quorum',
};

export const CIRCLE_POLICY_ENUMS = {
  view:                 ['chat', 'screen', 'cross-stream'],
  // llmTool — the circle's LLM posture, AUTHORITATIVE within the circle: 'off' forbids any LLM here
  // (privacy hard-stop, even if a member wants one); 'local'/'cloud' mandate that route for everyone;
  // 'user' = "user decides" → defer to each member's personal default LLM (see resolveCircleLlm).
  llmTool:              ['off', 'local', 'cloud', 'user'],
  // storagePosture — at-rest posture for the circle's shared content (the menukaart, per-circle).
  // 'p0' trusted host / plaintext (default — sealing OFF unless chosen); 'p1' TEE enclave (host-blind);
  // 'p2' client-side E2E group-key seal (household default); 'p3' sealed-at-rest, opened for processing.
  // Resolved by `@onderling/pod-client` `resolveCircleStorage` → a SealedPodClient strategy (or none for p0).
  storagePosture:       ['p0', 'p1', 'p2', 'p3'],
  // sharePosture — how an item is EXPOSED to an outsider when shared out of the circle
  // (admin-set, per-circle; see PLAN-circle-share-policy §3). 'closed' = external sharing off;
  // 'copy' = re-seal a fresh copy to the recipient; 'trusted' = member grants to a WebID (canonical,
  // recipient-sealed); 'registered' = admins-only, reader WebIDs added as recipients on the canonical item.
  // 'canonical' (objective L) = REVOCABLE canonical share: NO copy — the item stays canonical in its origin
  // circle and the recipient gets a revocable KEY GRANT (group-key wrap + ACP grant) to open it IN PLACE;
  // un-sharing rotates the key + ACP-revokes. Mirrors item-store's SHARE_POSTURES; routed via
  // `@onderling/pod-client` createCanonicalShare (share=grant, revoke=rotate). See circleShare.js.
  sharePosture:         ['closed', 'copy', 'trusted', 'registered', 'canonical'],
  // shareOutOfCircle — the axis that GOVERNS sharing an item OUT to an OUT-OF-CIRCLE recipient (a person
  // known only by their published network key, NOT a roster member); orthogonal to `sharePosture` (which
  // governs circle→circle sharing). Admin-set, per-circle. See circleShare.js `shareItemToPublishedKey`.
  //   'prohibit' — out-of-circle sharing is REFUSED (the admin blocked it): {ok:false, error:'share-prohibited'}.
  //   'notify'   — proceeds as a REVOCABLE CANONICAL in-place grant (the existing shareItemToPublishedKey
  //                path: key re-wrap + ACP grant on the canonical item, NO copy) AND emits a notification to
  //                the circle/admins that an item was shared outside — the TRANSPARENT middle.
  //   'silent'   — proceeds WITHOUT a circle-visible trace, and — for privacy — as a COPY (a separate object
  //                sealed to the recipient's network-derived key), NOT the canonical in-place grant (which
  //                would leave an ACP grant + shared-ref trace on the canonical item).
  shareOutOfCircle:     ['prohibit', 'notify', 'silent'],
  // notifyOutOfCircle — the TARGET of the `notify` mode's notification (only consulted when
  // shareOutOfCircle === 'notify'; ignored for 'prohibit'/'silent'). Admin-set, per-circle.
  // See circleShare.js `shareItemToPublishedKey` (the notify branch).
  //   'admins' — (default, the quieter option) ping the circle's ADMINS via @onderling/notify-envelope
  //              with { event:'item-shared-out-of-circle', itemId, fromCircleId, recipient, by }.
  //   'post'   — write a NOTICEBOARD post to the circle instead, tagged `category:'permission-log'`
  //              (+ `logKind`) so a FUTURE dedicated "logging" section can filter these permission
  //              notices OUT of the main board. (That logging section is DEFERRED; the post just
  //              carries the forward-compatible tag today.)
  notifyOutOfCircle:    ['admins', 'post'],
  agents:               ['yes', 'admin-approval', 'no'],
  revealPolicy:         ['pairwise', 'open'],
  pod:                  ['none', 'shared', 'personal', 'hybrid'],
  // ε.6 — per-kring chooser policy for negotiated catch-up.  'auto'
  // (default) keeps the ε.4 first-offer-wins behaviour byte-for-byte;
  // 'prompt' surfaces the multi-offer chooser modal so the user picks
  // which source streams + at what mode ('all'|'last-50'|'last-7-days').
  catchUpChooserMode:   ['auto', 'prompt'],
};

// Defaults match the "full Onderling" surface (strategy B): the
// orchestrator app lights up the features whose UI is already rendered
// today (chat + noticeboard + houseRules + memberDirectory).  The focus-apps
// in the store ('Buurt door Onderling', 'Huishouden door Onderling', 'OR-bot')
// will override these at pin-time to lock to their narrower surface.
// (S1 #1, 2026-06-15: noticeboard flipped on now that its prikbord surface exists.)
export const DEFAULT_CIRCLE_POLICY = {
  features: {
    chat:            true,
    noticeboard:     true,
    tasks:           false,
    lists:           false,
    calendar:        false,
    notes:           false,
    houseRules:      true,
    memberDirectory: true,
  },
  // Default 'screen' opens the per-circle detail surface on tap rather
  // than auto-routing to the classic chat shell.  The chat-route still
  // works for circles whose admin explicitly sets view='chat' (board
  // 5.9e / huisgenoten-style "chat as the kring's front door").  Until
  // the per-kring stream surface (right-hand side) is built,
  // 'screen' lands the user on the action-grid detail — at least they
  // can navigate to each feature from there instead of being kicked
  // out to the classic shell.
  view:             'screen',
  llmTool:          'off',
  storagePosture:   'p0',   // sealing OFF by default; the household app sets 'p2' on its circles
  sharePosture:     'closed', // INTERIM default pending product decision (PLAN-circle-share-policy §8) — 'copy' vs 'closed'
  // PRODUCT-TUNABLE default (FLAGGED): 'notify' is the transparent middle — out-of-circle person-sharing
  // works (backward-compatible with the shipped unconditional canonical grant) AND the circle/admins are
  // told it happened. 'prohibit' would break the shipped op by default; 'silent' would hide out-of-circle
  // sharing from admins by default (surprising, less transparent). Revisit with product.
  shareOutOfCircle: 'notify',
  // Notify TARGET (only consulted when shareOutOfCircle === 'notify'). Default 'admins' — the quieter
  // option: ping the admins rather than land a post on the (shared) board. See CIRCLE_POLICY_ENUMS.
  notifyOutOfCircle: 'admins',
  agents:           'admin-approval',
  // §5 escape hatch (story 3.3) — how long a member-vote stays open before an ADMIN may force it
  // ("Decide now"). Until 2026-07-26 no shell ever passed a deadline to `propose()`, so `expired` was never
  // true and a proposal that stalled short of quorum stayed open FOREVER with no way to resolve it. The
  // default now lives HERE and `makeGovernanceOrchestrator` applies it, so both shells inherit it by
  // construction rather than each remembering to pass one (invariant 1). `0` disables the hatch entirely —
  // a circle that wants decisions to stand open indefinitely can still say so.
  decisionDeadlineDays: 7,
  revealPolicy:     'pairwise',
  pod:              'none',
  // ε.6 — see CIRCLE_POLICY_ENUMS.catchUpChooserMode docstring above.
  // Default 'auto' so existing kringen catch up byte-for-byte the same
  // way ε.4 shipped.
  catchUpChooserMode: 'auto',
  admins:           [],
  consensusRequired: false,
  // Phase 4 §5 (L4) — per-action decision-class map (admin-set). Absent action ⇒ its
  // DEFAULT_GOVERNANCE class. See governanceDecision.js for the resolver.
  governance:       { ...DEFAULT_GOVERNANCE },
  // Connectivity Phase 4 §7/§9 — member↔member private chat (prikbord/DM). Off by default
  // (conservative); the settings surface only lets an admin enable it when the circle's route
  // supports a peer pairwise key (relay/rendezvous available), greyed under pod-only (no relay).
  privateDm:        false,
  // S6.C deep — which whole apps the circle composes; null = all DEFAULT_CIRCLE_ORIGINS.
  apps:             null,
  // B · (ruling) — the admin FREEDOM TEMPLATE: a partial map keyed by
  // "<app> <atom> <noun>" → { enabled?, freedom?, consequence?, privacyFloor? }. Absent entry ⇒
  // default-on; the capability gate (capabilityGate.js) narrows the effective set with this.
  capabilities:     {},
  // B · (ruling) — per-app SETTINGS VALUES the wizard/settings form writes, keyed by
  // "<app>.<settingKey>" → value. The manifest declares the schema; this holds the chosen values.
  settings:         {},
};

/**
 * return whether a feature is enabled on a (possibly partial)
 * policy.  Defensive: treats missing/non-policy input as the default
 * (so a circle whose `features` field hasn't been written yet still
 * surfaces the default-on features).
 *
 * @param {object|null|undefined} policy  — raw or normalised policy
 * @param {string} key                    — feature key (see CIRCLE_FEATURES)
 * @returns {boolean}
 */
export function isFeatureEnabled(policy, key) {
  if (!CIRCLE_FEATURES.includes(key)) return false;
  if (!policy || typeof policy !== 'object') {
    return DEFAULT_CIRCLE_POLICY.features[key];
  }
  const f = policy.features;
  if (!f || typeof f !== 'object') {
    return DEFAULT_CIRCLE_POLICY.features[key];
  }
  return typeof f[key] === 'boolean' ? f[key] : DEFAULT_CIRCLE_POLICY.features[key];
}

/** enumerate the enabled features on a policy, in CIRCLE_FEATURES order. */
export function enabledFeatures(policy) {
  return CIRCLE_FEATURES.filter((k) => isFeatureEnabled(policy, k));
}

// §4 — map the admin's `view` axis ('chat' | 'screen' | 'cross-stream')
// to the kring's default Schakelaar mode ('chat' | 'scherm').  This is the
// *front door* the admin chose: which surface a member lands on when they
// open the kring before they've ever toggled the pill themselves.
//
//   'screen'       → 'scherm'  (admin recipe'd page is the landing surface)
//   'chat'         → 'chat'    (v2 §4 default: chat IS the home view)
//   'cross-stream' → 'chat'    (the kring's content also flows into Stroom;
//                               inside the kring itself the conversation is
//                               still the natural home view)
//
// The per-user pill (cc.circleViewMode) overrides this once the member has
// flipped it — see readViewMode() (web) / the viewMode useEffect (mobile).
const VIEW_AXIS_TO_MODE = { screen: 'scherm', chat: 'chat', 'cross-stream': 'chat' };

/**
 * §4 — the default Schakelaar mode ('chat' | 'scherm') for a kring whose
 * member has no saved per-user pill preference yet.  Driven by the admin's
 * `policy.view` axis; falls back to the policy default ('screen') for
 * missing/invalid input so the result is always one of the two pill values.
 *
 * @param {object|null|undefined} policy — raw or normalised policy
 * @returns {'chat'|'scherm'}
 */
export function defaultViewModeFromPolicy(policy) {
  const axis = policy && typeof policy === 'object' && CIRCLE_POLICY_ENUMS.view.includes(policy.view)
    ? policy.view
    : DEFAULT_CIRCLE_POLICY.view;
  return VIEW_AXIS_TO_MODE[axis] ?? 'chat';
}

/** Coerce a stored partial `governance` map into the full action→class map (invalid ⇒ default). */
export function normalizeGovernance(stored = {}) {
  const g = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  const out = {};
  for (const action of GOVERNANCE_ACTIONS) {
    out[action] = GOVERNANCE_CLASSES.includes(g[action]) ? g[action] : DEFAULT_GOVERNANCE[action];
  }
  return out;
}

/** The decision-class for a governed action on a (possibly partial) policy. */
export function decisionClassFor(policy, action) {
  if (!GOVERNANCE_ACTIONS.includes(action)) return null;
  const g = policy && typeof policy === 'object' ? policy.governance : null;
  const cls = g && typeof g === 'object' ? g[action] : undefined;
  return GOVERNANCE_CLASSES.includes(cls) ? cls : DEFAULT_GOVERNANCE[action];
}

/** Coerce any stored partial into a complete, valid policy (invalid values fall back to defaults). */
export function normalizeCirclePolicy(stored = {}) {
  const p = stored && typeof stored === 'object' ? stored : {};
  const features = {};
  for (const f of CIRCLE_FEATURES) {
    features[f] = typeof p.features?.[f] === 'boolean' ? p.features[f] : DEFAULT_CIRCLE_POLICY.features[f];
  }
  const pickEnum = (key) =>
    CIRCLE_POLICY_ENUMS[key].includes(p[key]) ? p[key] : DEFAULT_CIRCLE_POLICY[key];
  return {
    features,
    view:               pickEnum('view'),
    llmTool:            pickEnum('llmTool'),
    storagePosture:     pickEnum('storagePosture'),
    sharePosture:       pickEnum('sharePosture'),
    shareOutOfCircle:   pickEnum('shareOutOfCircle'),
    notifyOutOfCircle:  pickEnum('notifyOutOfCircle'),
    agents:             pickEnum('agents'),
    revealPolicy:       pickEnum('revealPolicy'),
    pod:                pickEnum('pod'),
    catchUpChooserMode: pickEnum('catchUpChooserMode'),
    admins:             Array.isArray(p.admins) ? p.admins.filter((x) => typeof x === 'string') : [],
    // A non-negative finite number of days; anything else (missing, negative, NaN, a string) falls back to
    // the default rather than silently disabling or extending the escape hatch.
    decisionDeadlineDays:
      (typeof p.decisionDeadlineDays === 'number' && Number.isFinite(p.decisionDeadlineDays) && p.decisionDeadlineDays >= 0)
        ? p.decisionDeadlineDays
        : DEFAULT_CIRCLE_POLICY.decisionDeadlineDays,
    consensusRequired:
      typeof p.consensusRequired === 'boolean' ? p.consensusRequired : DEFAULT_CIRCLE_POLICY.consensusRequired,
    // §5 (L4) — decision-class per governed action; each falls back to DEFAULT_GOVERNANCE,
    // and only the known actions/classes survive (an unknown class → the action's default).
    governance:         normalizeGovernance(p.governance),
    // Phase 4 §7/§9 — member↔member private chat toggle (route-gated in the settings surface).
    privateDm:
      typeof p.privateDm === 'boolean' ? p.privateDm : DEFAULT_CIRCLE_POLICY.privateDm,
    // S6.C deep — which whole apps this circle composes into its catalog (the bot's
    // tools + slash-suggest). null/absent = all DEFAULT_CIRCLE_ORIGINS; a list
    // narrows (e.g. ['stoop'] for a buurt-only circle). Validation is loose here —
    // the catalog scoping intersects with the apps that actually have ops.
    apps:               Array.isArray(p.apps) ? p.apps.filter((x) => typeof x === 'string') : null,
    // kept as plain object maps; per-entry coercion happens at read time
    // (freedom.js resolveRow for capabilities; the manifest schema for settings).
    capabilities:       (p.capabilities && typeof p.capabilities === 'object' && !Array.isArray(p.capabilities)) ? p.capabilities : {},
    settings:           (p.settings && typeof p.settings === 'object' && !Array.isArray(p.settings)) ? p.settings : {},
  };
}

/** Deep-merge an edit `patch` onto `base`, then normalise (features merge per-key). */
export function mergeCirclePolicy(base, patch = {}) {
  const nb = normalizeCirclePolicy(base);
  const merged = {
    ...nb,
    ...patch,
    features:     { ...nb.features, ...(patch.features || {}) },
    // shallow-merge at the entry-key level (a patch replaces the whole row/value for a key).
    capabilities: { ...nb.capabilities, ...(patch.capabilities || {}) },
    settings:     { ...nb.settings, ...(patch.settings || {}) },
    governance:   { ...nb.governance, ...(patch.governance || {}) },
  };
  return normalizeCirclePolicy(merged);
}

export const DEFAULT_MEMBER_OVERRIDE = {
  chatOff:            false,
  revealOpen:         false,
  agentsMayContactMe: true,
  // per-kring push toggles. α.5b extends the v0
  // mention/message pair with two more types: noticeboard/agenda/task
  // items (`onNewItem`) and multi-admin voorstellen (`onProposal`).
  // Mentions, new items, and proposals are on by default so an actor
  // mentioning you / proposing something / posting a new item doesn't
  // fall silent; the "every message" toggle stays off by default so a
  // busy circle doesn't spam the notification tray.
  push: {
    onMention:      true,
    onEveryMessage: false,
    onNewItem:      true,
    onProposal:     true,
  },
  flowThrough:        { tasksToPersonal: false, calendarToPersonal: false },
  // B · (ruling) — the member's capability OPT-OUTS: an array of "<app> <atom> <noun>"
  // keys the member has declined. Only OPT-OUTABLE caps (admin freedom 'optional' OR a privacy floor)
  // can be opted out; the effective set is admin-template ∩ (not these). Enforced at the same gate.
  capabilityOptOuts:  [],
};

export function normalizeMemberOverride(stored = {}) {
  const o = stored && typeof stored === 'object' ? stored : {};
  const ft = o.flowThrough && typeof o.flowThrough === 'object' ? o.flowThrough : {};
  const ps = o.push && typeof o.push === 'object' ? o.push : {};
  return {
    chatOff:            !!o.chatOff,
    revealOpen:         !!o.revealOpen,
    agentsMayContactMe: typeof o.agentsMayContactMe === 'boolean' ? o.agentsMayContactMe : true,
    push: {
      onMention:      typeof ps.onMention      === 'boolean' ? ps.onMention      : true,
      onEveryMessage: typeof ps.onEveryMessage === 'boolean' ? ps.onEveryMessage : false,
      onNewItem:      typeof ps.onNewItem      === 'boolean' ? ps.onNewItem      : true,
      onProposal:     typeof ps.onProposal     === 'boolean' ? ps.onProposal     : true,
    },
    flowThrough: {
      tasksToPersonal:    !!ft.tasksToPersonal,
      calendarToPersonal: !!ft.calendarToPersonal,
    },
    capabilityOptOuts:  Array.isArray(o.capabilityOptOuts)
      ? [...new Set(o.capabilityOptOuts.filter((x) => typeof x === 'string'))]
      : [],
  };
}

export function mergeMemberOverride(base, patch = {}) {
  const b = normalizeMemberOverride(base);
  return normalizeMemberOverride({
    ...b,
    ...patch,
    push:        { ...b.push,        ...(patch.push        || {}) },
    flowThrough: { ...b.flowThrough, ...(patch.flowThrough || {}) },
  });
}

/**
 * decide whether to push a notification given the override + the
 * notification kind.  Pure; consumers wire this into the existing
 * notifier flow ([[5.7b]] isSuppressed hook).
 *
 * Kinds (α.5b):
 *   'mention'  — someone @-mentioned me
 *   'message'  — any new message in the circle
 *   'newItem'  — a new noticeboard / agenda / task / announcement item
 *   'proposal' — a new multi-admin voorstel
 *
 * Unknown kinds return `false` conservatively — a new notification
 * type stays silent until an override field is added for it here.
 */
export function shouldPushNotify(override, kind) {
  const o = normalizeMemberOverride(override);
  if (kind === 'mention')  return o.push.onMention;
  if (kind === 'message')  return o.push.onEveryMessage;
  if (kind === 'newItem')  return o.push.onNewItem;
  if (kind === 'proposal') return o.push.onProposal;
  return false;
}
