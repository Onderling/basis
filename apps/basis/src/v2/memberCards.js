/**
 * basis v2 — member-card projections (LEDEN tab → persona card + self-view).
 *
 * Two thin projections the LEDEN (members) tab taps into, both PURE and both
 * reusing the already-built machinery — no new visibility logic lives here:
 *
 *   • member-persona — tap a member row → what THIS viewer (me) may see of THAT
 *     member: `splitViewAsAttributes` (viewAsAttributes.js) run with viewer = me
 *     over the member's attributes.
 *   • self-view — tap your own row → "how others see me": pick a viewer kind
 *     (member / stranger / agent, per `VIEWER_KINDS` in circleViewAs.js) and the
 *     `{sees, hides}` split re-runs the same reveal rules over MY attributes.
 *
 * ── Re-homed onto the C7 reveal-state (Phase 4 Wave B) ──────────────────────
 * The one reveal-state home is `disclosure.js` (`@onderling/agent-registry`): a
 * per-(context, key) `{enabled, …}` policy, default-withhold, PLUS the amount
 * presets `handle → profile → full` (`REVEAL_PRESETS`). These cards now express
 * their result as that unified reveal-state and READ it back through
 * `isDisclosed`/`revealPresetOf` — the sees/hides split is driven by the
 * `enabled` axis, and each card SURFACES the amount preset it lands at. No
 * bespoke reveal truth lives here anymore; the presets are named by AMOUNT
 * (never a field name, never "verified"/identity).
 *
 * Disclosure is per-CIRCLE (context = the circle). Today the roster carries two
 * persona attributes — the handle (the pseudonym FLOOR, always shown) and the
 * real name (the presented self). We map them onto the preset tiers via
 * `personaPresetKeys` and let `revealPresetOf` name the amount.
 *
 * ── TWO LAYERS: member-disclosure AND viewer-entitlement ───────────────────
 * A viewer sees an attribute iff (a) the MEMBER disclosed it for this circle AND
 * (b) the VIEWER is entitled to it. Layer (a) is the member's per-circle
 * reveal-state — the `Peer.revealState` disclosure policy the Peer-façade now
 * populates (`packages/core/src/discovery/peerFacade.js`); the card reads it via
 * `isDisclosed(revealState, circleId, key)`. Layer (b) is the view-as gate
 * (`splitViewAsAttributes` — viewer kind / pairwise reveal / circle policy), which
 * still runs on top. When a card is handed a raw roster row rather than a Peer, it
 * derives the SAME member-disclosure policy locally via `memberRevealState`, so
 * behaviour is identical either way. `matchable`/`requestable` are OTHER axes and
 * never touch the reveal card.
 */

import {
  createDisclosurePolicy, applyRevealPreset, isDisclosed, revealPresetOf, REVEAL_PRESETS,
  setDisclosure, isSealedMediaRef,
} from '@onderling/agent-registry';
import { splitViewAsAttributes, viewAsCounts } from './viewAsAttributes.js';
import { VIEWER_KINDS } from './circleViewAs.js';

/**
 * The persona card's amount-preset key assignment (design §1.3, NOTE-reveal-state):
 * the handle is the pseudonym FLOOR (`handle` tier); the real name is the presented
 * self, and — as the top populated tier in a card that carries only handle + real
 * name — it rides the `profile` tier so that "real name shown" reads as the ceiling
 * (`full`, an empty top tier is vacuously satisfied above it). The two live states
 * today are therefore the floor `handle` and the ceiling `full`; the middle `profile`
 * label becomes reachable once picture/bio land as their own attributes (Wave B/C).
 * Per-tier OWN keys (non-cumulative) — `disclosure.js` makes them cumulative.
 */
export const PERSONA_TIER_KEYS = Object.freeze({ handle: ['handle'], profile: ['realName'], full: [] });

/** The persona tier's OWN keys for a preset (the `keysFor` the disclosure preset API expects). */
export function personaPresetKeys(preset) { return PERSONA_TIER_KEYS[preset] ?? []; }

// The reveal-state is read per (context, key). The RETURNED per-view state uses this opaque,
// stable slot ("what THIS viewer sees"); a member's OWN per-circle reveal-state (Peer.revealState)
// is keyed by the real circleId, which callers pass through as `circleId`.
const PERSONA_CTX = 'persona';

/**
 * Build a MEMBER's per-circle reveal-state — the disclosure policy the Peer-façade
 * populates on `Peer.revealState` (`peerFacade.js`), derived here from a raw roster row
 * when the card isn't handed a Peer, so behaviour is identical either way. `handle` is the
 * pseudonym FLOOR (always enabled); `realName` is disclosed for the circle iff the policy is
 * 'open' OR the member has revealed it to ≥1 peer (`reveals[]`). The per-PEER selection
 * (revealed to whom) is NOT a per-circle bit — it stays in the view-as gate, not here. Only
 * the `enabled` axis is set; `matchable`/`requestable` keep their withheld default.
 *
 * @param {object} args
 * @param {{reveals?:string[]}} args.member  the roster row (its reveal data)
 * @param {'open'|'pairwise'} [args.policy]  the circle's revealPolicy
 * @param {string} [args.contextId]          the reveal-state context (the circleId)
 * @returns {object} a disclosure policy (the member's per-circle reveal-state)
 */
export function memberRevealState({ member, policy = 'pairwise', contextId = PERSONA_CTX } = {}) {
  const m = member && typeof member === 'object' ? member : {};
  const realNameShared = policy === 'open' || (Array.isArray(m.reveals) && m.reveals.length > 0);
  const preset = realNameShared ? 'full' : 'handle';
  let pol = applyRevealPreset(createDisclosurePolicy(), contextId, preset, { keysFor: personaPresetKeys });
  // A profile picture present on the row was disclosed by the member (propagation is
  // reveal-gated), so enable its key independently of the realName preset — it then
  // renders only when the VIEWER is also entitled (the view-as gate still applies).
  if (isSealedMediaRef(m.profilePicture)) {
    pol = setDisclosure(pol, contextId, 'profilePicture', { enabled: true });
  }
  return pol;
}

/**
 * Build the unified per-(context, key) reveal-state describing ONE VIEW (what a specific
 * viewer sees) from the keys that view clears, so the card can READ back the `enabled` axis +
 * the amount preset. Real name in the seen set → the `full` amount preset; otherwise the
 * `handle` floor. Only the `enabled` axis is touched.
 *
 * @param {string[]} seenKeys  persona keys visible in this view
 * @returns {object} a disclosure policy (the per-view reveal-state)
 */
function revealStateFromSeen(seenKeys) {
  const preset = (Array.isArray(seenKeys) && seenKeys.includes('realName')) ? 'full' : 'handle';
  return applyRevealPreset(createDisclosurePolicy(), PERSONA_CTX, preset, { keysFor: personaPresetKeys });
}

/**
 * What a member's pairwise reveal COVERS — the attribute keys a viewer they revealed to may see.
 *
 * `reveals[]` is one act ("I show this person who I am"), not a per-attribute list, so it covers every
 * attribute the member disclosed at the pairwise level: the real name AND a profile picture they put on
 * their row (a picture is only ever there because they shared it — propagation is reveal-gated).
 *
 * This used to be hardcoded to `['realName']`, which made a shared picture UNREACHABLE under the default
 * `pairwise` policy: the member's own reveal-state enabled `profilePicture` (correctly, independent of the
 * name), but the viewer-entitlement gate could never clear it, so every picture render fell into `hides`
 * and only an `open` circle ever showed one. Layer (a) — the member's disclosure — still decides whether the
 * attribute exists at all, so this never widens anything the member didn't share.
 *
 * @param {{profilePicture?: any}} member
 * @returns {string[]} attribute keys a pairwise-revealed viewer clears
 */
export function pairwiseRevealCovers(member) {
  const m = member && typeof member === 'object' ? member : {};
  const keys = ['realName'];
  if (isSealedMediaRef(m.profilePicture)) keys.push('profilePicture');
  return keys;
}

/**
 * The full persona projection — the TWO layers combined. Layer (a) MEMBER-DISCLOSURE:
 * an attribute is disclosed for the circle iff it's the handle floor (always) or the
 * member's `revealState` marks its key `enabled` (read via `isDisclosed`). Layer (b)
 * VIEWER-ENTITLEMENT: the view-as gate decides who clears each attribute (viewer kind /
 * pairwise reveal / circle policy — still owned by `splitViewAsAttributes`). An attribute
 * is SEEN iff BOTH clear. The result is then expressed as the per-view reveal-state and its
 * amount preset (`revealPresetOf`) — the same card shape as before.
 *
 * @param {object} args
 * @param {Array<object>} args.attributes
 * @param {object} args.memberState  the member's per-circle reveal-state (Peer.revealState)
 * @param {string} args.contextId    the context `memberState` is keyed by (the circleId)
 * @param {object} args.viewer       the view-as viewer context
 * @param {'open'|'pairwise'} args.policy
 * @returns {{sees:object[], hides:object[], counts:object, preset:string|null, revealState:object}}
 */
function projectPersona({ attributes, memberState, contextId, viewer, policy }) {
  const gate = splitViewAsAttributes({ attributes, viewer, policy });
  const entitled = new Set(gate.sees.map((a) => a.key));
  const sees = [];
  const hides = [];
  for (const a of attributes) {
    const disclosed = a.key === 'handle' || isDisclosed(memberState, contextId, a.key);
    (disclosed && entitled.has(a.key) ? sees : hides).push(a);
  }
  const revealState = revealStateFromSeen(sees.map((a) => a.key));
  const preset = revealPresetOf(revealState, PERSONA_CTX, { keysFor: personaPresetKeys });
  return { sees, hides, counts: viewAsCounts({ sees, hides }), preset, revealState };
}

/**
 * Project a canonical roster member into the openness-tagged attribute list the
 * built `splitViewAsAttributes` consumes. Handle → `public` (always visible per
 * the circleViewAs model); real name → `pairwise` (revealed to a member who was
 * revealed to, or under an 'open' policy). `labelKey` rides through the split so
 * the shell resolves it via `t()` (no strings baked in here — invariant 8).
 *
 * @param {{handle?:string|null, realName?:string|null}} member
 * @returns {Array<{key:string, labelKey:string, value:any, openness:string}>}
 */
export function personaAttributes(member) {
  const m = member && typeof member === 'object' ? member : {};
  const out = [];
  if (m.handle) {
    out.push({ key: 'handle', labelKey: 'circle.memberCard.attr.handle', value: `@${m.handle}`, openness: 'public' });
  }
  out.push({ key: 'realName', labelKey: 'circle.memberCard.attr.realName', value: m.realName ?? null, openness: 'pairwise' });
  // Profile picture — a media-typed attribute whose value is a SEALED media ref
  // (the same shape chat photos ride). Present on the row ⇒ disclosed to this circle
  // (propagation is reveal-gated); `media: true` flags it for the img render path.
  if (isSealedMediaRef(m.profilePicture)) {
    out.push({
      key: 'profilePicture', labelKey: 'circle.memberCard.attr.profilePicture',
      value: m.profilePicture, openness: 'pairwise', media: true,
    });
  }
  return out;
}

/**
 * member-persona — what THIS viewer (me) may see of THAT member. TWO layers:
 * (a) the member's per-circle DISCLOSURE — read from the member's `revealState`
 *     (`Peer.revealState`, populated by the Peer-façade); when not injected it's
 *     derived from the roster row via `memberRevealState` (identical result); AND
 * (b) my ENTITLEMENT — the view-as gate: my real name is 'revealed to me' iff the
 *     member put my webid in their `reveals` list (or the circle policy is 'open',
 *     which `isVisibleTo` handles). An attribute is seen iff BOTH clear. Pure.
 *
 * @param {object}  args
 * @param {{id?:string, handle?:string|null, realName?:string|null, reveals?:string[]}} args.member
 * @param {string|null} [args.viewerWebid]  my webid (the viewer)
 * @param {'open'|'pairwise'} [args.policy='pairwise']  the circle's revealPolicy
 * @param {string} [args.circleId]           the reveal-state context (the circle)
 * @param {object|null} [args.revealState]   the member's `Peer.revealState`; derived when absent
 * @returns {{sees:object[], hides:object[], counts:{visible:number,hidden:number,total:number}, preset:string|null, revealState:object}}
 */
export function memberPersonaView({ member, viewerWebid = null, policy = 'pairwise', circleId = PERSONA_CTX, revealState = null } = {}) {
  const m = member && typeof member === 'object' ? member : {};
  const memberState = revealState ?? memberRevealState({ member: m, policy, contextId: circleId });
  const revealedToMe = (viewerWebid && Array.isArray(m.reveals) && m.reveals.includes(viewerWebid))
    ? pairwiseRevealCovers(m) : [];
  const viewer = { kind: 'member', id: viewerWebid ?? null, revealedToMe };
  return projectPersona({ attributes: personaAttributes(m), memberState, contextId: circleId, viewer, policy });
}

/**
 * self-view — how a CHOSEN viewer sees ME. Same two layers: (a) MY per-circle
 * disclosure (`memberRevealState` over my row, or an injected `revealState`) AND
 * (b) the chosen viewer's entitlement — for a member viewer my real name is
 * 'revealed to them' iff I put their webid in MY `reveals` list; a stranger/agent
 * never clears the pairwise gate. An attribute is seen iff BOTH clear. Pure.
 *
 * @param {object}  args
 * @param {{id?:string, handle?:string|null, realName?:string|null, reveals?:string[]}} args.me
 * @param {{kind?:string, id?:string|null}} [args.viewer]  the chosen viewer (VIEWER_KINDS)
 * @param {'open'|'pairwise'} [args.policy='pairwise']  the circle's revealPolicy
 * @param {string} [args.circleId]           the reveal-state context (the circle)
 * @param {object|null} [args.revealState]   my `Peer.revealState`; derived when absent
 * @returns {{sees:object[], hides:object[], counts:{visible:number,hidden:number,total:number}, preset:string|null, revealState:object}}
 */
export function selfViewSplit({ me, viewer = { kind: 'stranger' }, policy = 'pairwise', circleId = PERSONA_CTX, revealState = null } = {}) {
  const m = me && typeof me === 'object' ? me : {};
  const v = viewer && typeof viewer === 'object' ? viewer : {};
  const memberState = revealState ?? memberRevealState({ member: m, policy, contextId: circleId });
  const revealedToMe = (v.kind === 'member' && v.id && Array.isArray(m.reveals) && m.reveals.includes(v.id))
    ? pairwiseRevealCovers(m) : [];
  const enrichedViewer = { ...v, revealedToMe };
  return projectPersona({ attributes: personaAttributes(m), memberState, contextId: circleId, viewer: enrichedViewer, policy });
}

/**
 * The user-facing label KEY for a reveal preset (invariant 8 — resolved via `t()`, never a
 * baked string). `handle → profile → full` (the pinned amount vocabulary). A null preset
 * (nothing reaches even the floor) has no label.
 * @param {string|null} preset  one of REVEAL_PRESETS, or null
 * @returns {string|null}
 */
export function revealPresetLabelKey(preset) {
  return REVEAL_PRESETS.includes(preset) ? `circle.reveal.preset.${preset}` : null;
}

export { VIEWER_KINDS, REVEAL_PRESETS };
