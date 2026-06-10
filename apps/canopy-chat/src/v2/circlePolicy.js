/**
 * canopy-chat v2 — circle policy + member override model (shared, F2).
 *
 * A circle's settings are a small record keyed by circleId (board 4: the
 * five axes) plus a per-member override record (board 6). This module is
 * the pure model: defaults, enum validation, normalisation (merge a
 * stored partial onto defaults), and deep-merge for edits. Persistence
 * (pod `shared.json` per the cross-app-settings convention) is wired by
 * the host on top — kept out of here so it stays unit-testable + portable.
 */

export const CIRCLE_FEATURES = [
  'chat', 'noticeboard', 'tasks', 'lists', 'calendar', 'notes', 'houseRules', 'memberDirectory',
];

export const CIRCLE_POLICY_ENUMS = {
  view:                 ['chat', 'screen', 'cross-stream'],
  // llmTool — the circle's LLM posture, AUTHORITATIVE within the circle: 'off' forbids any LLM here
  // (privacy hard-stop, even if a member wants one); 'local'/'cloud' mandate that route for everyone;
  // 'user' = "user decides" → defer to each member's personal default LLM (see resolveCircleLlm).
  llmTool:              ['off', 'local', 'cloud', 'user'],
  agents:               ['yes', 'admin-approval', 'no'],
  revealPolicy:         ['pairwise', 'open'],
  pod:                  ['none', 'shared', 'personal', 'hybrid'],
  // ε.6 — per-kring chooser policy for negotiated catch-up.  'auto'
  // (default) keeps the ε.4 first-offer-wins behaviour byte-for-byte;
  // 'prompt' surfaces the multi-offer chooser modal so the user picks
  // which source streams + at what mode ('all'|'last-50'|'last-7-days').
  catchUpChooserMode:   ['auto', 'prompt'],
};

// Defaults match the "full Onderling" surface (board 2 strategy B): the
// orchestrator app lights up the features whose UI is already rendered
// today (chat + houseRules + memberDirectory).  The focus-apps in the
// store ('Buurt door Onderling', 'Huishouden door Onderling', 'OR-bot')
// will override these at pin-time to lock to their narrower surface.
export const DEFAULT_CIRCLE_POLICY = {
  features: {
    chat:            true,
    noticeboard:     false,
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
  // the per-kring stream surface (board 2B right-hand side) is built,
  // 'screen' lands the user on the action-grid detail — at least they
  // can navigate to each feature from there instead of being kicked
  // out to the classic shell.
  view:             'screen',
  llmTool:          'off',
  agents:           'admin-approval',
  revealPolicy:     'pairwise',
  pod:              'none',
  // ε.6 — see CIRCLE_POLICY_ENUMS.catchUpChooserMode docstring above.
  // Default 'auto' so existing kringen catch up byte-for-byte the same
  // way ε.4 shipped.
  catchUpChooserMode: 'auto',
  admins:           [],
  consensusRequired: false,
};

/**
 * P6.1 — return whether a feature is enabled on a (possibly partial)
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

/** P6.1 — enumerate the enabled features on a policy, in CIRCLE_FEATURES order. */
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
    agents:             pickEnum('agents'),
    revealPolicy:       pickEnum('revealPolicy'),
    pod:                pickEnum('pod'),
    catchUpChooserMode: pickEnum('catchUpChooserMode'),
    admins:             Array.isArray(p.admins) ? p.admins.filter((x) => typeof x === 'string') : [],
    consensusRequired:
      typeof p.consensusRequired === 'boolean' ? p.consensusRequired : DEFAULT_CIRCLE_POLICY.consensusRequired,
  };
}

/** Deep-merge an edit `patch` onto `base`, then normalise (features merge per-key). */
export function mergeCirclePolicy(base, patch = {}) {
  const merged = {
    ...normalizeCirclePolicy(base),
    ...patch,
    features: { ...normalizeCirclePolicy(base).features, ...(patch.features || {}) },
  };
  return normalizeCirclePolicy(merged);
}

export const DEFAULT_MEMBER_OVERRIDE = {
  chatOff:            false,
  revealOpen:         false,
  agentsMayContactMe: true,
  // P6.M4 (board 6A) — per-kring push toggles.  α.5b extends the v0
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
 * P6.M4 — decide whether to push a notification given the override + the
 * notification kind.  Pure; consumers wire this into the existing
 * notifier flow ([[5.7b]] isSuppressed hook).
 *
 * Kinds (α.5b):
 *   'mention'  — someone @-mentioned me
 *   'message'  — any new message in the circle
 *   'newItem'  — a new noticeboard / agenda / task / announcement item
 *   'proposal' — a new multi-admin voorstel (P6.2)
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
