/**
 * postAudience — state-machine helpers lifted from
 * src/web/wizards/postAudienceWizard.js (2026-05-24).
 *
 * The wizard composes audience targeting on top of stoop's
 * postRequest skill.  Zero DOM, zero RN here — pure value
 * transforms + the submit wrapper.
 */

/** Trust-level options shown in the radio group. */
export const TRUST_OPTS = Object.freeze([
  { id: 'all',     label: 'Everyone in the circle' },
  { id: 'known',   label: 'Known contacts only'    },
  { id: 'trusted', label: 'Trusted contacts only'  },
]);

/** Distance grid options (km).  `km: 0` means "no limit". */
export const DISTANCE_OPTS = Object.freeze([
  { km: 1,  label: '1 km'  }, { km: 2,  label: '2 km'  }, { km: 5,  label: '5 km'  },
  { km: 10, label: '10 km' }, { km: 25, label: '25 km' }, { km: 0,  label: 'No limit' },
]);

/** Initial state from optional pre-seed args. */
export function initialState(args = {}) {
  return {
    text:             args.text ?? '',
    kind:             args.kind ?? 'ask',
    minTrust:         'all',
    tags:             '',
    distanceKm:       0,
    recipients:       '',
    availableCircles:  null,        // null = loading, [] = failed, [...] = loaded
    selectedCircle:    args.groupId ?? null,
    submitting:       false,
    submitError:      null,
  };
}

/** Whether the [Post] button is enabled. */
export function canSubmit(state) {
  return !state.submitting && String(state.text ?? '').trim().length > 0;
}

/**
 * Build the audience object from form state.  Omits null + empty
 * slots so substrate sees a tight object (no `tags: []`-style noise).
 *
 * Pure function — easy to assert in tests.
 */
export function buildAudience(state) {
  const tags       = String(state.tags ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const recipients = String(state.recipients ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const audience = {};
  if (state.minTrust && state.minTrust !== 'all') audience.minTrust = state.minTrust;
  if (tags.length > 0)                            audience.tags = tags;
  if (state.distanceKm)                           audience.distanceKm = state.distanceKm;
  if (recipients.length > 0)                      audience.recipients = recipients;
  return audience;
}

/**
 * Compose the full postRequest args from form state — convenient
 * for tests + for the RN wizard to reuse.
 */
export function buildPostRequestArgs(state) {
  const audience = buildAudience(state);
  const targets  = state.selectedCircle
    ? [{ kind: 'group', groupId: state.selectedCircle }]
    : undefined;
  return {
    text: state.text, kind: state.kind,
    ...(targets ? { targets, groupId: state.selectedCircle } : {}),
    ...(Object.keys(audience).length > 0 ? { audience } : {}),
  };
}

/**
 * Lazy-load the circle list via stoop.getCurrentGroup.  Mutates
 * state.availableCircles in place; returns the mutated state.
 */
export async function loadAvailableCircles({ state, callSkill }) {
  try {
    const reply  = await callSkill('stoop', 'getCurrentGroup', {});
    const groups = reply?.groupId
      ? [{ id: reply.groupId, label: reply.title ?? reply.groupId }]
      : [];
    state.availableCircles = groups;
    if (groups.length === 1 && !state.selectedCircle) state.selectedCircle = groups[0].id;
  } catch {
    state.availableCircles = [];
  }
  return state;
}

/**
 * Submit the post via callSkill('stoop', 'postRequest', composedArgs).
 * Mutates state in place (submitting / submitError).  Returns
 * `{result?, state}` so the caller can react to success.
 */
export async function submitPost({ state, callSkill }) {
  state.submitting  = true;
  state.submitError = null;
  try {
    const result = await callSkill('stoop', 'postRequest', buildPostRequestArgs(state));
    if (result?.error) throw new Error(result.error);
    state.submitting = false;
    return { result, state };
  } catch (err) {
    state.submitError = err?.message ?? String(err);
    state.submitting  = false;
    return { state };
  }
}
