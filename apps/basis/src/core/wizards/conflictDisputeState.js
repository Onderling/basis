/**
 * conflictDispute — state-machine helpers lifted from
 * src/web/wizards/conflictDisputeWizard.js (2026-05-24).
 *
 * Zero DOM, zero RN.  Wraps the V0 substrate gap (pinboard hasn't
 * shipped raiseDispute / proposeResolution / acceptResolution yet
 * — see the web wizard's preamble); the dispute is filed as a
 * `kind: 'dispute'` postRequest with a structured text body.
 *
 * Mobile parity: when pinboard ships the dedicated dispute skills,
 * `submitDispute` swaps its call site without the wizard layers
 * needing to know.
 */

/** Escalation-path options shown in the radio group. */
export const ESCALATION_PATHS = Object.freeze([
  { id: 'mediation', label: 'Mediation (two random members weigh in)' },
  { id: 'admin',     label: 'Admin decides' },
  { id: 'vote',      label: 'Member vote' },
]);

/** Initial state for the wizard, optionally pre-seeded from `args`. */
export function initialState(args = {}) {
  return {
    step:           1,
    // accept either `postId` (slash flag) or `id` (default
    // callbackData arg when launched via a row button).
    aboutPostId:    args.postId ?? args.id ?? '',
    aboutPostText:  null,
    summary:        '',
    escalation:     'mediation',
    proposal:       '',
    proposalShared: false,
    submitting:     false,
    submitError:    null,
    successResult:  null,
  };
}

/** Step-1 advance gate: summary needs at least 10 trimmed chars. */
export function isSummaryValid(summary) {
  return String(summary ?? '').trim().length >= 10;
}

/** Step-2 advance gate: proposal needs at least 5 trimmed chars. */
export function isProposalValid(proposal) {
  return String(proposal ?? '').trim().length >= 5;
}

/** Lookup a radio-option label by id, falling back to the id itself. */
export function labelOf(options, id) {
  return options.find((o) => o.id === id)?.label ?? id;
}

/**
 * Lazy-load the post text via pinboard.listFeed so the UI can show
 * "Disputing: <text>" instead of a raw ulid.  Mutates state in
 * place; resolves silently on failure (UI falls back to id).
 */
export async function loadAboutPostText({ state, callSkill }) {
  if (!state.aboutPostId) return state;
  try {
    const reply = await callSkill('pinboard', 'listFeed', {});
    const items = reply?.items ?? [];
    const hit = items.find((p) =>
      p?.id === state.aboutPostId
      || p?.source?.requestId === state.aboutPostId,
    );
    state.aboutPostText = hit?.text ?? hit?.label ?? null;
  } catch { /* silent — UI keeps the id */ }
  return state;
}

/**
 * Format the dispute as a structured text body for the V0 substrate
 * gap (pinboard.postRequest with kind:'dispute').  Pure function so
 * both web + RN wizards format identically + the future real
 * dispute skill can re-parse it for migration if needed.
 */
export function formatDisputeText(state) {
  const tail = state.aboutPostId ? `\nAbout: ${state.aboutPostId}` : '';
  return `[Dispute] ${state.summary}\n\nProposed: ${state.proposal}\n\nPreferred escalation: ${state.escalation}${tail}`;
}

/**
 * File the dispute via callSkill('pinboard', 'postRequest', ...).
 * Mutates state in place; returns `{result?, state}`.
 */
export async function submitDispute({ state, callSkill }) {
  state.submitting  = true;
  state.submitError = null;
  try {
    const result = await callSkill('pinboard', 'postRequest', {
      text: formatDisputeText(state),
      kind: 'dispute',
    });
    if (result?.error) throw new Error(result.error);
    state.successResult = result;
    return { result, state };
  } catch (err) {
    state.submitError = err?.message ?? String(err);
    state.submitting  = false;
    return { state };
  }
}
