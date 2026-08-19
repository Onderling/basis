/**
 * guidedSetup — a template-driven conversational "settings chatbot" (Theme B).
 *
 * A circle's config is set up by walking the user through a few questions in
 * chat, driven by a TEMPLATE that Onderling can update remotely (open-source) —
 * so onboarding copy/flow improves without an app release. The bot collects
 * answers, builds a circle-policy patch, and can HAND OFF to the GUI settings
 * form mid-flow ("let me just show you the toggles").
 *
 * This module is the pure engine + the bundled fallback template + the remote
 * loader. The UI (web/mobile) just renders the current step + feeds answers back.
 * No DOM, no network here (fetch is injected) — fully unit-testable.
 *
 * Template shape:
 *   { id, version, start, steps: { <id>: STEP } }
 *   STEP = {
 *     say?:    string,                       // a statement (no input) — show + continue
 *     ask?:    string,                       // a question — show + collect an answer
 *     kind?:   'choice' | 'multiselect',     // how to answer an `ask`
 *     options?:[{ value, label }],           // for choice/multiselect
 *     sets?:   string,                       // the circle-policy field the answer fills
 *     next?:   string,                       // the next step id (absent → end)
 *     handoff?:boolean,                       // end the flow + open the GUI settings form
 *   }
 *
 * Per-option branching (opt-in, backward-compatible): a `choice` option may carry
 * its own `next` / `handoff`, which override the step's when that option is picked.
 * Templates whose options carry neither behave exactly as before (the step-level
 * `next`/`handoff` still apply). This lets an onboarding template send "yes → open
 * the create wizard (handoff)" while "later → continue" — without an engine fork.
 *
 * The template carries its own copy (it's remote content, not UI chrome); the UI
 * chrome (Continue / Skip / Open settings) stays localized via t().
 */

/** Bundled fallback — a minimal circle-setup flow. Remote templates override it. */
export const DEFAULT_SETTINGS_TEMPLATE = Object.freeze({
  id: 'circle-setup',
  version: 1,
  start: 'intro',
  steps: {
    intro: {
      say: "Let's set up this circle — a couple of quick choices, and you can fine-tune the rest in settings.",
      next: 'apps',
    },
    apps: {
      ask: 'Which apps will this circle use?',
      kind: 'multiselect',
      sets: 'apps',
      options: [
        { value: 'stoop',    label: 'Neighbourhood' },
        { value: 'tasks',    label: 'Tasks' },
        { value: 'calendar', label: 'Calendar' },
        { value: 'folio',    label: 'Files' },
        { value: 'household', label: 'Lists' },   // K0: household = the simple-LISTS app (vs tasks = graphs)
      ],
      next: 'storage',
    },
    storage: {
      ask: "How private should this circle's data be?",
      kind: 'choice',
      sets: 'storagePosture',
      options: [
        { value: 'p0', label: 'Open — stored locally, simplest' },
        { value: 'p2', label: 'Sealed — end-to-end encrypted for members' },
      ],
      next: 'ai',
    },
    ai: {
      ask: "Allow AI to help in this circle's chat?",
      kind: 'choice',
      sets: 'llmTool',
      options: [
        { value: 'user', label: 'Yes — each member uses their own LLM' },
        { value: 'off',  label: 'No AI in this circle' },
      ],
      next: 'done',
    },
    done: {
      say: "Great — that's the basics. Open settings any time to fine-tune apps, privacy and more.",
      handoff: true,
    },
  },
});

/** Whether a value is a usable template (validated before we run a remote one). */
export function isValidTemplate(t) {
  if (!t || typeof t !== 'object') return false;
  if (typeof t.id !== 'string' || !t.id) return false;
  if (!t.steps || typeof t.steps !== 'object') return false;
  const ids = Object.keys(t.steps);
  if (ids.length === 0) return false;
  const start = t.start ?? ids[0];
  return typeof start === 'string' && !!t.steps[start];
}

/** Fresh run state for a template. */
export function startGuidedSetup(template) {
  const start = template.start ?? Object.keys(template.steps)[0];
  return { templateId: template.id, stepId: start, answers: {} };
}

/** The current step object, or null when the flow is over. */
export function stepOf(template, state) {
  return (state && state.stepId && template.steps?.[state.stepId]) || null;
}

/**
 * Advance the flow. For a `say` step, pass no answer; for an `ask` step, pass the
 * chosen value(s). Returns the next state + whether the answer was applied + the
 * end/handoff signals.
 *
 * @returns {{ state, applied: {key, value}|null, handoff: boolean, done: boolean }}
 */
export function submitGuidedStep(template, state, answer) {
  const step = stepOf(template, state);
  if (!step) return { state, applied: null, handoff: false, done: true };

  const answers = { ...state.answers };
  let applied = null;
  if (step.ask && step.sets && answer !== undefined) {
    answers[step.sets] = answer;
    applied = { key: step.sets, value: answer };
  }
  // Per-option branching: for a `choice`, a picked option's own next/handoff wins
  // over the step's. Options without either fall through to the step level, so
  // existing (settings) templates are unaffected.
  const chosen = (step.kind === 'choice' && Array.isArray(step.options) && answer !== undefined)
    ? step.options.find((o) => o && o.value === answer) ?? null
    : null;
  const handoff = !!(chosen && chosen.handoff !== undefined ? chosen.handoff : step.handoff);
  const nextId = handoff
    ? null
    : (chosen && chosen.next !== undefined ? chosen.next : (step.next ?? null));
  return {
    state: { ...state, stepId: nextId, answers },
    applied,
    handoff,
    done: !nextId || handoff,
  };
}

/**
 * Build a circle-policy patch from the collected answers. The template's `sets`
 * keys are circle-policy fields, so the patch is the answers as-is — `mergeCirclePolicy`
 * normalizes + rejects anything invalid (a bad template can't corrupt the policy).
 */
export function guidedPolicyPatch(state) {
  return { ...(state?.answers ?? {}) };
}

/**
 * Load a settings template, preferring a remote (HQ-updatable, open-source) one
 * and falling back to the bundled default. `fetch` is injected for testability.
 *
 * @param {object} [args]
 * @param {string}   [args.url]        remote template URL
 * @param {Function} [args.fetchImpl]  defaults to global fetch
 * @param {object}   [args.fallback]   defaults to DEFAULT_SETTINGS_TEMPLATE
 */
export async function loadSettingsTemplate({ url, fetchImpl = globalThis.fetch, fallback = DEFAULT_SETTINGS_TEMPLATE } = {}) {
  if (!url || typeof fetchImpl !== 'function') return fallback;
  try {
    const res = await fetchImpl(url);
    const json = await res.json();
    return isValidTemplate(json) ? json : fallback;
  } catch {
    return fallback;
  }
}
