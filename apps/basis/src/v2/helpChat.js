/**
 * helpChat — the standing help Q&A router (shared web + mobile). Pure: it turns a posted message +
 * the current language + whether an LLM is connected into a DESCRIPTOR of what the Onderling-bot
 * should post. It never calls a network or a model:
 *
 *   HIT  (layer 0/1) → the deterministic kaartje answer (from `answerHelp`), carrying its transparency
 *                      provenance so the "answered directly — no language model used" badge lights up.
 *   MISS + an LLM connected → OFFER the consent card (the shell posts the dashed-rust card + buttons;
 *                      on "yes" it forwards the query through the EXISTING consent-gated circle LLM
 *                      route — that execution is the shell's job, not this pure module's).
 *   MISS + no LLM    → the honest fallback: only the set topics can be answered without an assistant.
 *
 * The set-topic chips (and `/help` slash) resolve DETERMINISTICALLY to their kaartje answer via
 * `resolveHelpTopic`. The action namespace (`help:*`) mirrors onboardingChat's `onboarding:*` so the
 * shell routes button taps the same way.
 */

import { answerHelp, answerHelpTopic, helpTopics, likelyHelpTopics } from './help/helpAnswer.js';

/** Inline-button action namespace for a help affordance (topic chip / consent choice). */
export const HELP_ACTION_PREFIX = 'help:';
const TOPIC_PREFIX = 'topic:';
const CONSENT_PREFIX = 'consent:';
/** The button `action` string for "all topics": after the likeliest few, the whole list. */
export const HELP_ALL_ACTION = `${HELP_ACTION_PREFIX}topics`;

/** The button `action` string for a pickable help topic. */
export function helpTopicAction(id) { return `${HELP_ACTION_PREFIX}${TOPIC_PREFIX}${id}`; }

/** The button `action` string for a consent choice ('yes' → forward · 'no' → pick a topic yourself). */
export function helpConsentAction(value) { return `${HELP_ACTION_PREFIX}${CONSENT_PREFIX}${value}`; }

/**
 * Parse an inline-button action back to a help affordance, or null when it isn't one.
 * @returns {{kind:'topic', id:string} | {kind:'consent', value:string} | null}
 */
export function parseHelpAction(action) {
  if (typeof action !== 'string' || !action.startsWith(HELP_ACTION_PREFIX)) return null;
  if (action === HELP_ALL_ACTION) return { kind: 'all' };
  const rest = action.slice(HELP_ACTION_PREFIX.length);
  if (rest.startsWith(TOPIC_PREFIX)) {
    const id = rest.slice(TOPIC_PREFIX.length);
    return id ? { kind: 'topic', id } : null;
  }
  if (rest.startsWith(CONSENT_PREFIX)) {
    const value = rest.slice(CONSENT_PREFIX.length);
    return value ? { kind: 'consent', value } : null;
  }
  return null;
}

/**
 * Route a posted help query → what the bot should post.
 *
 *   { kind: 'hit', text, provenance }  — deterministic card answer; `provenance.llmUsed === false`
 *                                        lights the "answered directly" badge; `source` rides along.
 *   { kind: 'consent' }                — miss + an LLM is connected → offer the consent card.
 *   { kind: 'topics' }                 — miss + no LLM → honest fallback + the set-topic chips.
 *
 * @param {string} query
 * @param {{ lang?: string, llmReady?: boolean }} [opts]
 */
export function routeHelpMessage(query, { lang, llmReady } = {}) {
  const ans = answerHelp(query, { lang });
  if (ans) return { kind: 'hit', text: ans.text, provenance: { llmUsed: false, source: ans.source } };
  return llmReady ? { kind: 'consent' } : { kind: 'topics' };
}

/**
 * The pickable set-topic chips ("of kies zelf") — one per answerable heading. Each carries a
 * `help:topic:<id>` action the shell routes through `parseHelpAction` → `resolveHelpTopic`.
 * @param {{ lang?: string }} [opts]
 * @returns {Array<{ label: string, action: string }>}
 */
export function helpTopicChips({ lang, query = null, allLabel = null } = {}) {
  const all = helpTopics({ lang }).map((topic) => ({ label: topic.kop, action: helpTopicAction(topic.id) }));
  // after a question: the five likeliest topics first, the rest behind one "all topics" chip (walk row 81: ~30 buttons
  // and none of them the one asked for); a question that shares nothing with any topic gets the whole list
  const likely = typeof query === 'string' && allLabel ? likelyHelpTopics(query, { lang }) : [];
  if (!likely.length) return all;
  return [...likely.map((topic) => ({ label: topic.kop, action: helpTopicAction(topic.id) })), { label: allLabel, action: HELP_ALL_ACTION }];
}

/**
 * Pick the LOCALE KEYS for the LLM-forward wording, honestly matched to the resolved route.
 *
 * A 'confidential-proxy' route (Privatemode/TEE) may truthfully be named "de vertrouwelijke assistent";
 * a plain route (a local Ollama, an OpenAI-compatible cloud) may NOT — it is just "de assistent". Both
 * shells (web + mobile) call this ONE helper so they always pick the same variant for the same route.
 *
 * @param {{ confidential?: boolean }} [route]
 * @returns {{ badgeKey: string, consentKey: string }}
 *   badgeKey   — the provenance badge stamped under an LLM answer.
 *   consentKey — the consent-card prompt asking to forward the question.
 */
export function helpLlmLabelKeys({ confidential } = {}) {
  return confidential
    ? { badgeKey: 'circle.help.provenance_llm',       consentKey: 'circle.help.consent_prompt' }
    : { badgeKey: 'circle.help.provenance_llm_plain', consentKey: 'circle.help.consent_prompt_plain' };
}

/**
 * Resolve a picked topic id → its deterministic card answer, or null for an unknown id.
 * @param {string} id
 * @param {{ lang?: string }} [opts]
 * @returns {{ text: string, provenance: { llmUsed: boolean, source: object } } | null}
 */
export function resolveHelpTopic(id, { lang } = {}) {
  const ans = answerHelpTopic(id, { lang });
  if (!ans) return null;
  return { text: ans.text, provenance: { llmUsed: false, source: ans.source } };
}
