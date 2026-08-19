/**
 * basis v2 — what a circle's conversation shows (decided 2026-07-28).
 *
 * Every event in a circle lands in one append-only log: chat, but also tasks, offerings, governance, roster
 * pings, delivery state, agent actions. Until now the chat surface showed everything in the `human` lane —
 * a list drawn by whoever wrote `entryKinds.js`, not chosen by anyone.
 *
 * Frits' decision: **the admin decides, and the default is permissive.**
 *
 *   human kinds (chat · task · vraag · leen)   → on
 *   offerings (`aanbod`)                        → on
 *   system / technical                          → off, but the admin may turn any of them on
 *
 * ── Why it is seeded from the circle TEMPLATE ────────────────────────────────────────────────────────────
 * Frits: *"didnt we have circle starting templates? Maybe it should be part of that too!"* — and he is
 * right, because the correct default is already not uniform. The templates disagree today:
 *
 *   household · friends   `features.chat: true`   — talking is the point
 *   **buurt**                   `features.chat: FALSE`  — noticeboard-first; a thread appears only when
 *                                                          someone reacts to a vraag or aanbod
 *   team                        `features.chat: true`, noticeboard off
 *
 * So a buurt's conversation showing chat messages contradicts its own template. That is the case this axis
 * exists for, and it comes from the existing templates rather than a hypothetical.
 *
 * So the template picks the starting point and the admin setting overrides it — exactly how `features`,
 * `revealPolicy` and `pod` already work. And because the wizard is what APPLIES a template, the axis has to
 * appear there too, or the default is set by something the creator never sees.
 *
 * ── It is a FILTER, not a data change ────────────────────────────────────────────────────────────────────
 * Nothing is dropped from the log. Turning a kind off hides it from one surface in one circle, and turning
 * it back on brings the history with it. That is the whole reason `entryKinds.js` carries `lane` centrally
 * rather than each surface deciding for itself.
 */
import { ENTRY_KINDS, LANE, conversationKinds as humanKinds } from '@onderling/item-store';

/** Kinds that are on unless a circle says otherwise. */
export function defaultConversationKinds() {
  // Derived, not listed: adding a human kind to the registry cannot forget the conversation surface.
  return humanKinds();
}

/** Every kind an admin may choose from, with whether it is on by default. */
export function availableConversationKinds() {
  return Object.entries(ENTRY_KINDS).map(([kind, spec]) => ({
    kind,
    lane: spec.lane,
    defaultOn: spec.lane === LANE.HUMAN,
  }));
}

/**
 * The conversation-kinds axis for a circle template.
 *
 * `null` means "the permissive default" — deliberately not a copy of the list, so a kind added to the
 * registry later is included rather than silently missing from every template written before it.
 */
export const TEMPLATE_CONVERSATION_KINDS = Object.freeze({
  household:     null,   // a home: everything, it is all one conversation
  friends: null,   // friends: same
  team:          null,   // work: tasks belong in the stream
  // A buurt has `features.chat: false` — it is noticeboard-first, and a thread appears only when someone
  // reacts to a vraag or aanbod. So its conversation is those posts, NOT open chat; showing chat messages
  // there would contradict the template that created it.
  buurt: Object.freeze(['vraag', 'aanbod', 'task', 'leen']),
});

/**
 * Resolve what a circle's conversation shows.
 *
 * Precedence: the circle's own setting → its template's → the permissive default. Same shape as the other
 * template axes, so an admin choice always wins over a template and a template over the global default.
 *
 * @param {object} [a]
 * @param {string[]|null} [a.circleSetting]  what this circle's admin chose
 * @param {string} [a.templateKind]          the circle's kind, for the template default
 * @returns {string[]} kinds the conversation shows
 */
export function resolveConversationKinds({ circleSetting = null, templateKind = null } = {}) {
  if (Array.isArray(circleSetting)) return sanitize(circleSetting);

  const fromTemplate = templateKind && Object.prototype.hasOwnProperty.call(TEMPLATE_CONVERSATION_KINDS, templateKind)
    ? TEMPLATE_CONVERSATION_KINDS[templateKind]
    : null;
  if (Array.isArray(fromTemplate)) return sanitize(fromTemplate);

  return defaultConversationKinds();
}

/**
 * Turn one kind on or off for a circle, returning the new list.
 *
 * Takes the RESOLVED list rather than the stored setting, so the first change a circle makes starts from
 * what it was actually showing — otherwise turning one kind off would silently adopt the whole default set
 * as an explicit choice, freezing it against future registry changes.
 */
export function setConversationKind(current, kind, on) {
  const set = new Set(sanitize(current));
  if (!(kind in ENTRY_KINDS)) return [...set];       // an unknown kind is a typo, not a new feature
  if (on) set.add(kind); else set.delete(kind);
  return [...set];
}

/** Drop anything that is not a registered kind. An unregistered one cannot be shown honestly. */
function sanitize(kinds) {
  const out = [];
  for (const k of Array.isArray(kinds) ? kinds : []) {
    if (typeof k === 'string' && k in ENTRY_KINDS && !out.includes(k)) out.push(k);
  }
  return out;
}

/** The kind a chat line is. Named once so the derivation below cannot drift from the registry. */
export const CHAT_KIND = 'chat-message';

/**
 * Does this circle's conversation include chat? — **the single source for that fact** (decision 3,
 * 2026-07-29).
 *
 * `features.chat` and `conversationKinds` were two vocabularies for one thing: the wizard wrote the
 * first, the conversation read the second, and nothing reconciled them. That is how a buurt created with
 * chat OFF ended up showing a chat surface (S3/J-CW3) — each half was correct about its own field.
 *
 * The kinds list wins, because it is the richer of the two: it already carries the resolver, the
 * templates, the viewer filter and the per-circle ceiling. `features.chat` becomes a view of it rather
 * than a second place to look.
 *
 * Takes the same inputs as `resolveConversationKinds` so a caller cannot accidentally consult a
 * different list than the conversation renders.
 *
 * @param {{circleSetting?: string[]|null, templateKind?: string|null}} a
 * @returns {boolean}
 */
export function chatIsInConversation({ circleSetting = null, templateKind = null } = {}) {
  return resolveConversationKinds({ circleSetting, templateKind }).includes(CHAT_KIND);
}

/**
 * Project a circle policy so `features.chat` reports what the conversation will actually show.
 *
 * Applied at the READ side rather than by rewriting stored policies: an existing circle's stored
 * `features.chat` may disagree with its kinds list, and the honest resolution is to believe the list
 * rather than to silently edit what the admin saved. A migration would also have to guess for every
 * circle written before the two were reconciled.
 *
 * @param {object} policy   a normalised circle policy
 * @returns {object} the same policy with `features.chat` derived
 */
export function withDerivedChatFeature(policy) {
  const p = policy && typeof policy === 'object' ? policy : {};
  const list = Array.isArray(p.conversationKinds) ? p.conversationKinds : null;
  const kind = typeof p.kind === 'string' && p.kind ? p.kind : null;
  // Derived unconditionally: with no backwards-compatibility requirement (Frits, 2026-07-29) there is no
  // pre-decision circle whose stored flag has to be honoured, so the list is simply the answer. A circle
  // with neither field resolves to the permissive default, which includes chat — coherent, since that is
  // exactly what its conversation shows.
  const chat = chatIsInConversation({ circleSetting: list, templateKind: kind });
  return { ...p, features: { ...(p.features && typeof p.features === 'object' ? p.features : {}), chat } };
}

/**
 * The admin control for a circle's conversation kinds — the row model both shells render.
 *
 * `setConversationKind` existed with no call site for a day (S3/J-CW5: "passes for the wrong reason —
 * nobody has the control, admin included"). This is that call site, expressed the way `chatFilterChips`
 * expresses the reader's own filter: a pure model, so the shells add only markup.
 *
 * Every registered kind appears, on or off, so an admin can see what a conversation COULD contain rather
 * than only what it currently does. The rows carry the whole next list rather than a delta, so a shell
 * persists what it was given and cannot compute a different set than the one it displayed.
 *
 * An admin MAY switch everything off — a circle is allowed to show nothing, and `resolveConversationKinds`
 * already respects an empty explicit choice. That is deliberately unlike the reader's filter, which
 * refuses to construct an empty conversation for itself: the admin is deciding what the circle IS, the
 * reader is deciding what they look at.
 *
 * @param {object} a
 * @param {string[]|null} [a.circleSetting]  the circle's stored list, if it has chosen one
 * @param {string|null} [a.templateKind]     the circle's kind, for the template default
 * @returns {Array<{kind: string, labelKey: string, on: boolean, lane: string, next: string[]}>}
 */
export function conversationKindsRows({ circleSetting = null, templateKind = null } = {}) {
  const current = resolveConversationKinds({ circleSetting, templateKind });
  // HUMAN lane only. `availableConversationKinds()` returns every registered kind, governance ones
  // included, and `chatRows` projects the human lane regardless of this list — so a governance checkbox
  // here would appear to do something and do nothing. Worse, it would invite an admin to try putting
  // decisions in the conversation, which J-L1 exists to prevent. The lane is enforced by the projection;
  // this control should not pretend otherwise.
  return availableConversationKinds().filter(({ lane }) => lane === LANE.HUMAN).map(({ kind, lane }) => {
    const on = current.includes(kind);
    return {
      kind,
      lane,
      labelKey: `circle.conversationKinds.${kind}`,
      on,
      // What to persist if this row is tapped: the list with this kind flipped.
      next: setConversationKind(current, kind, !on),
    };
  });
}
