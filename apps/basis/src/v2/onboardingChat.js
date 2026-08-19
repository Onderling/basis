/**
 * onboardingChat — render the guided onboarding template AS the Onderling-bot's chat
 * (shared web + mobile). Pure: it turns template + run-state into the bot bubbles to
 * post and the option buttons to attach; the shell only appends events + rerenders.
 *
 * A `say` step becomes a plain bot bubble and auto-advances; a `choice` step becomes a
 * bot bubble carrying one inline button per option. A picked option submits its value
 * back through the engine (`submitGuidedStep`), which may hand off (→ open the create
 * wizard) or continue. So the whole conversation renders in the circle chat surface with
 * no bespoke UI — the bot's messages + inline buttons the surface already draws.
 */
import { stepOf, submitGuidedStep } from './guidedSetup.js';

/** Inline-button action namespace for an onboarding option (so the shell can route taps). */
export const ONBOARDING_ACTION_PREFIX = 'onboarding:';

/** The button `action` string for an onboarding option value. */
export function onboardingActionFor(value) {
  return `${ONBOARDING_ACTION_PREFIX}${value}`;
}

/** Parse an inline-button action back to its onboarding option value, or null. */
export function parseOnboardingAction(action) {
  if (typeof action !== 'string' || !action.startsWith(ONBOARDING_ACTION_PREFIX)) return null;
  return action.slice(ONBOARDING_ACTION_PREFIX.length) || null;
}

/** The inline buttons for a `choice` step's options (label + namespaced action). */
function optionButtons(step) {
  const options = Array.isArray(step?.options) ? step.options : [];
  return options.map((o) => ({ label: o.label ?? o.value, action: onboardingActionFor(o.value) }));
}

/**
 * Advance the flow from `state`, collecting the bot bubbles to post now. Consecutive
 * `say` steps auto-advance (each a bubble); the walk parks at the first `choice` step
 * (its bubble carries `buttons`) or at the end.
 *
 * @param {object} template
 * @param {object} state    a run-state (from startGuidedSetup or a prior turn)
 * @returns {{
 *   bubbles: Array<{ text: string, buttons: Array<{label,action}>|null }>,
 *   state: object,          // parked run-state (awaiting an answer, or ended)
 *   awaiting: boolean,      // true → parked at a choice, waiting for a button tap
 *   done: boolean,          // true → the flow ended (no more steps or handoff)
 *   handoff: boolean,       // true → a say-step handoff ended the flow
 * }}
 */
export function onboardingTurn(template, state) {
  const bubbles = [];
  let s = state;
  let step = stepOf(template, s);
  while (step) {
    const text = step.say ?? step.ask ?? '';
    if (step.ask) {
      // Interactive — post the prompt with its option buttons and park for the answer.
      bubbles.push({ text, buttons: optionButtons(step) });
      return { bubbles, state: s, awaiting: true, done: false, handoff: false };
    }
    // Statement — post it and auto-advance.
    bubbles.push({ text, buttons: null });
    const r = submitGuidedStep(template, s, undefined);
    s = r.state;
    if (r.handoff) return { bubbles, state: s, awaiting: false, done: true, handoff: true };
    if (r.done) return { bubbles, state: s, awaiting: false, done: true, handoff: false };
    step = stepOf(template, s);
  }
  return { bubbles, state: s, awaiting: false, done: true, handoff: false };
}

/**
 * Answer the choice the flow is parked on, then continue the walk. Returns the picked
 * option's echo label (for a me-bubble), whether the answer triggered a handoff, and —
 * when it didn't — the next bot bubbles + parked state (via `onboardingTurn`).
 *
 * @param {object} template
 * @param {object} state   the parked run-state (awaiting a choice answer)
 * @param {string} value   the picked option value
 * @returns {{
 *   echo: string|null,                       // the picked option's label, for the me-bubble
 *   handoff: boolean,                         // true → open the create wizard, flow ends
 *   bubbles: Array<{text,buttons}>,           // next bot bubbles (empty on handoff)
 *   state: object, awaiting: boolean, done: boolean,
 * }}
 */
export function answerOnboarding(template, state, value) {
  const step = stepOf(template, state);
  const opt = Array.isArray(step?.options) ? step.options.find((o) => o && o.value === value) : null;
  const echo = opt ? (opt.label ?? opt.value) : null;
  const r = submitGuidedStep(template, state, value);
  if (r.handoff) {
    return { echo, handoff: true, bubbles: [], state: r.state, awaiting: false, done: true };
  }
  const turn = onboardingTurn(template, r.state);
  return { echo, handoff: false, ...turn };
}
