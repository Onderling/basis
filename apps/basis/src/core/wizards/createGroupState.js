/**
 * createGroup — state-machine helpers lifted from
 * src/web/wizards/createGroupWizard.js (2026-05-24).
 *
 * Zero DOM — pure value transforms + policy catalogues + the
 * finalSubmit substrate chain.  The web wizard's render layer
 * keeps the DOM construction (5 steps + success screen);
 * basis-mobile's RN wizard imports these helpers verbatim.
 */
import { CIRCLE_STORAGE_POSTURE_NAMES, DEFAULT_CIRCLE_STORAGE_POSTURE } from '@onderling/pod-routing';


// 5.5a — Step 3 captures the structured v2 rules doc instead of a
// single free-text field.  The renderers iterate `RULES_QUESTIONS`
// (purpose is handled by Step 1; the rules step shows the other five).
import {
  DEFAULT_RULES_DOC, buildRulesDoc, RULES_FIELDS,
} from '../../v2/circleRules.js';
// 5.5c — Step 4 captures the v2 offering list (the four axes per offering).
// `normalizeOffering` coerces partial rows; `DEFAULT_OFFERING` seeds a new row.
import { OFFERING_AXES, DEFAULT_OFFERING, normalizeOffering } from '@onderling/kring-host/circleOfferings';
export { OFFERING_AXES };
// β.4 — kind-aware "+ new circle" templates.  Picking a kind in Step 1
// pre-fills the policy axes (features / revealPolicy / pod / llmTool /
// agents / consensusRequired) with the matching template's defaults
// for any axis the user hasn't already overridden.
import { applyTemplate, markAxisTouched, CIRCLE_KINDS, SIZE_BANDS, recommendChat } from '../../v2/circleTemplates.js';
import { INVITE_CEILING_FALLBACK } from '@onderling-app/stoop/lib/inviteCeiling';
import { ROLE_TEMPLATE_IDS, applyRoleTemplates } from '../../v2/roleTemplates.js';
export { CIRCLE_KINDS, SIZE_BANDS, ROLE_TEMPLATE_IDS };

/* ─── Policy catalogues ───────────────────────────────────────── */

export const ACCESS_POLICIES = Object.freeze([
  { id: 'invite-only', label: 'Invite only (admins issue invites)' },
  { id: 'request',     label: 'Request to join (admins approve)' },
  { id: 'open',        label: 'Open (anyone with the circle id joins)' },
]);

export const LEAVE_POLICIES = Object.freeze([
  { id: 'anyone',       label: 'Anyone can leave at any time' },
  { id: 'notify-first', label: 'Leavers notify the circle before going' },
]);

export const CONFLICT_POLICIES = Object.freeze([
  { id: 'admin-decides', label: 'Admin decides' },
  { id: 'mediation',     label: 'Mediation by two random members' },
  { id: 'vote',          label: 'Member vote' },
]);

/**
 * The wizard's storage choices. The IDS are not written here — they are the canonical posture names,
 * so a posture added to the vocabulary cannot be silently missing from the picker, and one removed
 * cannot linger in it. Only the wording is this file's.
 */
const STORAGE_POLICY_LABELS = {
  none:     'No pod (local only — simplest)',
  personal: 'Personal pods (each member keeps their own)',
  shared:   'One shared circle pod (needs a URI)',
  hybrid:   'Hybrid (per-member + circle pod — needs a URI)',
};
export const STORAGE_POLICIES = Object.freeze(
  CIRCLE_STORAGE_POSTURE_NAMES.map((id) => Object.freeze({ id, label: STORAGE_POLICY_LABELS[id] ?? id })),
);

export const KEY_ROTATION_MODES = Object.freeze([
  { id: 'admin-only',         label: 'Admin-only (rotation requires admin action)' },
  { id: 'peer-distributable', label: 'Peer-distributable (any active member can rotate)' },
]);

// 5.5c — Offerings is now its own step between Rules and Tech.  Renderers
// drive their step machinery off `STEP_NAMES.length`, so adding here
// promotes Tech→5 and Review→6 without touching the increment logic.
export const STEP_NAMES = Object.freeze(['Identity', 'Governance', 'Rules', 'Offerings', 'Tech', 'Review']);

/** A fresh blank offering row for the wizard's "+ Add offering" affordance. */
export function newOfferingRow() {
  return { ...DEFAULT_OFFERING };
}

/* ─── Helpers ───────────────────────────────────────────────── */

/** Slugify a free-form name into a circle-id candidate. */
export function slugify(s) {
  return String(s ?? '').toLowerCase().trim()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30);
}

/** Validate a circle id: lowercase, digits, _ / -; 3-30 chars. */
export function isValidSlug(s) {
  return typeof s === 'string'
    && /^[a-z0-9](?:[a-z0-9_-]{1,28}[a-z0-9])?$/.test(s);
}

/** Lookup a policy-option label by id, falling back to the id itself. */
export function labelOf(options, id) {
  return options.find((o) => o.id === id)?.label ?? id;
}

/**
 * β.4 — pick a kind and pre-fill policy axes from `circleTemplates`.
 *
 * Returns a new state object (does NOT mutate the input).  The merge
 * preserves every axis the user has already set — picking a kind only
 * fills the gaps.  Switching kinds is therefore essentially a no-op
 * for axes the previous kind already filled (see circleTemplates.js
 * header for the design call).
 *
 * @param {object} state — current wizard state
 * @param {string} kind  — kind picked (household / neighbourhood / friends / team)
 * @returns {object} new state with `kind` + policy axes filled
 */
export function setKind(state, kind) {
  return applyTemplate(state, kind);
}

/* ─── N1 — neighbourhood size + chat advice ─────────────────────────────── */

/**
 * N1 — record the expected neighbourhood size (drives the chat recommendation).
 * Pure; does not mutate `features.chat` (the neighbourhood template already
 * defaults it OFF) — only the advice *strength* changes with size.
 *
 * @param {object} state
 * @param {'small'|'large'|null} size
 * @returns {object}
 */
export function setSize(state, size) {
  const s = state && typeof state === 'object' ? state : {};
  return { ...s, size: SIZE_BANDS.includes(size) ? size : null };
}

/**
 * N1 — explicit user override of the chat feature.  Marks `chatUserSet`
 * so any future re-derivation respects the user's choice.
 *
 * @param {object} state
 * @param {boolean} on
 * @returns {object}
 */
export function setChatEnabled(state, on) {
  const s = state && typeof state === 'object' ? state : {};
  // `chatUserSet` is kept for the advice logic that already reads it; `markAxisTouched` is what a kind
  // switch consults (decision 4). Both say the same thing about the same axis.
  return markAxisTouched({
    ...s,
    features:    { ...(s.features && typeof s.features === 'object' ? s.features : {}), chat: !!on },
    chatUserSet: true,
  }, 'features.chat');
}

/**
 * N1 — the chat recommendation for the current (kind, size) — what the
 * wizard renders as an advice banner next to the chat toggle.
 *
 * @param {object} state
 * @returns {{ value: boolean, mode: string, reasonKey: string|null }}
 */
export function chatAdvice(state) {
  const s = state && typeof state === 'object' ? state : {};
  return recommendChat({ kind: s.kind ?? null, size: s.size ?? null });
}

/* ─── N3 — extra role templates (admin opt-in) ──────────────────── */

/**
 * N3 — toggle an extra-role template on/off in the wizard state.  Only
 * known template ids are accepted.
 *
 * @param {object} state
 * @param {string} templateId
 * @returns {object}
 */
export function toggleRole(state, templateId) {
  const s = state && typeof state === 'object' ? state : {};
  if (!ROLE_TEMPLATE_IDS.includes(templateId)) return { ...s };
  const cur = Array.isArray(s.extraRoles) ? s.extraRoles : [];
  const next = cur.includes(templateId)
    ? cur.filter((id) => id !== templateId)
    : [...cur, templateId];
  return { ...s, extraRoles: next };
}

/**
 * N1+E8 — the circle-policy patch the create wizard persists onto the
 * new circle (features incl. the neighbourhood chat-off default, plus the
 * template's reveal/pod/llm/agents/consensus axes).  Only includes axes
 * a template actually filled.  Shared by the web + RN wizards so both
 * write the same policy.
 *
 * @param {object} state
 * @returns {object} patch for circlePolicyStore.update
 */
export function policyPatchFromState(state) {
  const s = state && typeof state === 'object' ? state : {};
  const patch = {};
  if (s.features && typeof s.features === 'object') patch.features = s.features;
  for (const ax of ['revealPolicy', 'pod', 'llmTool', 'agents']) {
    if (s[ax] !== undefined) patch[ax] = s[ax];
  }
  // The wizard's "decide together?" axis COMPILES to the decision table (the decision-kind
  // unification): true → policy changes need admin agreement (admin-quorum); false → an admin
  // saves directly (any-admin, the lived default). The boolean never reaches the policy shape.
  if (s.consensusRequired !== undefined) {
    patch.governance = { changePolicy: s.consensusRequired ? 'admin-quorum' : 'any-admin' };
  }
  // Decision 3 — the two fields the reader has always asked for and nobody ever wrote. Without them a
  // circle cannot remember which template made it, so its conversation has no relation to the kind its
  // creator chose (S3/J-CW2, J-CW3).
  if (typeof s.kind === 'string' && s.kind) patch.kind = s.kind;
  if (s.conversationKinds !== undefined) patch.conversationKinds = s.conversationKinds;
  return patch;
}

/* ─── Initial state ─────────────────────────────────────────── */

export function initialState() {
  return {
    step: 1,                          // 1..5
    // Step 1 — identity & purpose
    name:                  '',
    groupId:               '',
    purpose:               '',
    tags:                  '',
    // β.4 — kind picker.  Set via `setKind(state, kind)` which also
    // pre-fills the policy axes from the matching template.  Unset by
    // default so the wizard renders the picker before any template
    // applies.
    kind:                  null,
    // N1 — expected neighbourhood size; drives the chat-feature advice (large
    // neighbourhood → advise chat off; small → ask).  null until chosen.
    size:                  null,
    // N1 — true once the user explicitly toggles the chat feature, so
    // a later re-derivation respects their choice over the template.
    chatUserSet:           false,
    // N3 — extra role templates the admin opted into (ids from
    // ROLE_TEMPLATE_IDS).  Persisted as `rules.roles` at submit.
    extraRoles:            [],
    // Step 2 — members & governance
    additionalAdmins:      '',
    accessPolicy:          'invite-only',
    leavePolicy:           'anyone',
    // Step 3 — rules & conflict
    // 5.5a — structured v2 rules doc (purpose syncs from Step 1 at submit).
    rulesDoc:              { ...DEFAULT_RULES_DOC },
    conflictPolicy:        'mediation',
    // Step 4 — offerings (5.5c): a list of `{name,openness,posture,status,radius}`
    // rows; rows without a name are dropped at submit.
    offerings:             [],
    // Step 4 — tech & storage
    keyRotationMode:       'admin-only',
    rotationDays:          30,
    inviteExpiresInHours:  1,
    // B5 — the circle-level CEILING on how many people one of its invites may admit. `setKind`
    // pre-fills it from the kind (`inviteCeilingForKind`); this is what a circle created WITHOUT
    // picking a kind gets, and it is deliberately the same number the substrate falls back to for a
    // circle whose rules say nothing. One meaning of "nobody chose", not two.
    inviteMaxRedemptions:  INVITE_CEILING_FALLBACK,
    storagePolicy:         DEFAULT_CIRCLE_STORAGE_POSTURE,
    groupPodUri:           '',
    // Submission
    submitting:            false,
    submitError:           null,
    successResult:         null,
  };
}

/* ─── Rules object + submit ────────────────────────────────── */

/**
 * Build the rules object from wizard state.  Shared by finalSubmit
 * (sent to substrate) and the invite-URL encoder (shipped to joiner).
 * Pure function — no side effects, easy to test.
 */
export function buildRulesObjectFromState(state) {
  const additionalAdmins = String(state.additionalAdmins ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  const tags = String(state.tags ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);
  // 5.5a — Step 1's `purpose` is the canonical one-liner; it lives in
  // the rules doc too so joiners see it in the consent screen.
  const doc = buildRulesDoc({ ...state.rulesDoc, purpose: state.purpose });
  const rules = {
    tags:              tags.length > 0 ? tags : undefined,
    additionalAdmins:  additionalAdmins.length > 0 ? additionalAdmins : undefined,
    accessPolicy:      state.accessPolicy,
    leavePolicy:       state.leavePolicy,
    conflictPolicy:    state.conflictPolicy,
  };
  for (const k of RULES_FIELDS) {
    if (doc[k]) rules[k] = doc[k];
  }
  // 5.5c — embed normalised offerings (drop unnamed rows) in the rules
  // blob.  createGroupV2 spreads the blob verbatim, so the substrate
  // persists them under the group-rules item without needing its own
  // offerings arg (a dedicated substrate slot is a follow-up).
  // Read-accept a legacy in-memory `state.skills`; write the new
  // `rules.offerings` field + a transitional `rules.skills` alias so an
  // un-migrated reader of the persisted rules blob keeps working.
  const offeringRows = Array.isArray(state.offerings) ? state.offerings
    : (Array.isArray(state.skills) ? state.skills : []);
  if (offeringRows.length > 0) {
    const named = offeringRows.map(normalizeOffering).filter((s) => s.name.trim() !== '');
    if (named.length > 0) { rules.offerings = named; rules.skills = named; }
  }
  // N3 — persist the admin's opted-in extra roles (from templates) so
  // joiners receive them in the invite + consent screen.
  if (Array.isArray(state.extraRoles) && state.extraRoles.length > 0) {
    const roles = applyRoleTemplates(state.extraRoles);
    if (roles.length > 0) rules.roles = roles;
  }
  for (const k of Object.keys(rules)) {
    if (rules[k] === undefined) delete rules[k];
  }
  return rules;
}

/**
 * Encode the substrate's `{groupId, code, expiresAt, adminPeerAddr?, rules?}`
 * result into a `onderling-invite://<base64url-of-JSON>` URL the joiner
 * can paste into `/join-group`.  Lifted from web/createGroupWizard.js
 * 2026-05-27 so the mobile success-screen can reuse it.
 *
 * @param {{ groupId: string, code: string, expiresAt?: number, adminPeerAddr?: string, rules?: object }} result
 * @returns {string}
 */
export function encodeMembershipCodeUrl(result) {
  const payload = {
    kind:      'membershipCode',
    groupId:   result.groupId,
    code:      result.code,
    expiresAt: result.expiresAt,
    ...(result.adminPeerAddr ? { adminPeerAddr: result.adminPeerAddr } : {}),
    // B2 — the admin's NKN native address, so a pure-NKN joiner can route the
    // redeem to the admin (the pubKey adminPeerAddr isn't NKN-routable). Additive.
    ...(result.adminNknAddr ? { adminNknAddr: result.adminNknAddr } : {}),
    ...(result.rules    ? { rules:    result.rules    } : {}),
    // The circle's NAME (L55): the joiner names their circle from the invite alone. This whitelist
    // silently drops any field it does not know — that is the gotcha in the notes — so it goes here too.
    ...(typeof result.name === 'string' && result.name.trim() ? { name: result.name.trim() } : {}),
    // embed the circle's freedom template so the joiner can review + opt out of
    // OPT-OUTABLE capabilities at join (see circleConsent.js). Symmetric with the embedded rules doc.
    ...(result.capabilities && typeof result.capabilities === 'object' && !Array.isArray(result.capabilities) && Object.keys(result.capabilities).length
      ? { capabilities: result.capabilities } : {}),
    ...(Array.isArray(result.apps) && result.apps.length ? { apps: result.apps } : {}),
    // Offering→property fold-in phase C — the circle's "offering-matching is ON here" charter
    // signal; the join wizard turns it into the visible pre-checked share-offerings default. Only
    // ever an explicit true; absent on older invites / non-matching circles (default-withhold).
    ...(result.offeringsMatching === true ? { offeringsMatching: true } : {}),
    // NKN+pod circle (J-NP3) — the pod disclosure + its url must ride the WIRE, not just the invite
    // object: this encoder whitelists, and until 2026-07-28 it silently DROPPED both fields, so a
    // joiner from a real pasted/scanned URI never saw the disclosure the object-path tests proved.
    // Url only ever beside the flag (a pod url on a non-pod invite is noise claiming to be a place).
    ...(result.podBacked === true ? { podBacked: true } : {}),
    ...(result.podBacked === true && typeof result.podUrl === 'string' ? { podUrl: result.podUrl } : {}),
    // The RELAY endpoint (invite-carries-endpoint decision) — how a pasted-invite joiner learns where
    // the circle lives; rule 1 records it on their device at join.
    ...(typeof result.relayUrl === 'string' ? { relayUrl: result.relayUrl } : {}),
  };
  return encodeInviteUri(payload);
}

/**
 * The wire form of an invite payload: `onderling-invite://<base64url-of-JSON>`.
 *
 * Split out of `encodeMembershipCodeUrl` so a caller that has to REBUILD an invite — the broadcast clamp
 * strips the relay endpoint before putting one in a room — can re-encode without going back through the
 * field whitelist above. That distinction is load-bearing: the whitelist silently dropped `podBacked`/
 * `podUrl` until 2026-07-28, and round-tripping an already-built invite through it would re-create
 * exactly that class of silent loss for every field it does not yet know about.
 */
export function encodeInviteUri(payload) {
  const json = JSON.stringify(payload);
  if (typeof globalThis.btoa !== 'function') return `onderling-invite://${json}`;
  const b64 = globalThis.btoa(json)
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `onderling-invite://${b64}`;
}

/**
 * Final submission: build the `rules` blob from collected fields +
 * call createGroupV2.  Mutates state.submitting / state.submitError
 * / state.successResult.  Returns `{result?, state}`.
 *
 * On success: caller can post-process the result (the original web
 * wizard adds adminPeerAddr + rules into the result before stashing as
 * successResult; mobile may do the same in its own wrapper).
 */
export async function finalSubmit({ state, callSkill }) {
  state.submitting  = true;
  state.submitError = null;
  try {
    const rules  = buildRulesObjectFromState(state);
    const result = await callSkill('stoop', 'createGroupV2', {
      groupId:              state.groupId,
      name:                 state.name,
      rules,
      keyRotationMode:      state.keyRotationMode,
      rotationDays:         state.rotationDays,
      inviteExpiresInHours: state.inviteExpiresInHours,
      inviteMaxRedemptions: state.inviteMaxRedemptions,
      storagePolicy:        state.storagePolicy,
      ...(state.groupPodUri ? { groupPodUri: state.groupPodUri } : {}),
    });
    if (result?.error) throw new Error(result.error);
    return { result, state };
  } catch (err) {
    state.submitError = err?.message ?? String(err);
    state.submitting  = false;
    return { state };
  }
}
