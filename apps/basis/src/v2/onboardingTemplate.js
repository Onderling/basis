/**
 * onboardingTemplate — the first-run onboarding conversation, as guided-setup content.
 *
 * A brand-new user's first experience is a chat with the Onderling-bot in a "help"
 * circle: they learn "a bot is just a member you talk to" before meeting it as
 * machinery. This module carries that conversation as a template for the SAME engine
 * the settings chatbot uses (`guidedSetup.js`: startGuidedSetup / submitGuidedStep /
 * stepOf) — it does NOT overload the settings template.
 *
 * The copy is remote content, so it is language-resolved here (nuchtere Dutch + EN)
 * and remote-updatable without an app release via `loadOnboardingTemplate` (same
 * loader shape as `loadSettingsTemplate`, its own URL + bundled fallback). The flow
 * (which step follows which) is single-sourced in `FLOW`; only the leaf copy differs
 * per language.
 *
 * Flow: welkom (who the bot is + encrypted + no account) → wat_is_dit (messages/
 * tasks/plans for neighbourhood/household/club) → own_circle (choice: "start your
 * own circle?" — YES hands off to the create wizard, LATER continues) → uitnodigen
 * (point at the invite flow) → klaar. Short, honest, no hype.
 */
import { isValidTemplate } from './guidedSetup.js';

/**
 * The flow skeleton — step ids, their kind, and where each goes next. Copy lives in
 * `COPY` per language; `buildOnboardingTemplate` stitches the two. A `choice` option
 * may carry its own `next`/`handoff` (the engine's per-option branching): the "ja"
 * option hands off to the create-circle wizard; "later" continues to `uitnodigen`.
 */
const FLOW = Object.freeze({
  id: 'onboarding',
  version: 1,
  start: 'welkom',
  steps: {
    welkom:      { kind: 'say',    next: 'wat_is_dit' },
    wat_is_dit:  { kind: 'say',    next: 'own_circle' },
    own_circle: {
      kind: 'choice',
      sets: 'wantsCircle',
      options: [
        { value: 'ja',    handoff: true },   // → end the flow + open the create-circle wizard
        { value: 'later', next: 'uitnodigen' },
      ],
    },
    uitnodigen:  { kind: 'say',    next: 'klaar' },
    klaar:       { kind: 'say' },            // no next → flow ends
  },
});

/** Per-language leaf copy for each step (the bot's line + any option labels). */
const COPY = Object.freeze({
  nl: {
    welkom: 'Hoi, ik ben Onderling. Dit is een circle — een plek waar je met een paar mensen dingen regelt. Ik ben zelf ook gewoon lid van deze circle; je praat met mij zoals met iedereen. Je berichten zijn versleuteld en je hoeft geen account te maken.',
    wat_is_dit: 'Onderling is voor het dagelijkse: berichten, taken en afspraken. Voor je buurt, je huishouden of een club. Klein en overzichtelijk.',
    own_circle: {
      ask: 'Wil je zelf een circle beginnen?',
      options: { ja: 'Ja, help me', later: 'Nu even niet' },
    },
    uitnodigen: 'Prima. Als je een circle hebt, kun je buren of huisgenoten uitnodigen met een link of een QR-code. Dat kan ook later nog.',
    klaar: 'Klaar. Ik blijf hier staan — stel gerust een vraag als je iets wilt weten.',
  },
  en: {
    welkom: "Hi, I'm Onderling. This is a circle — a place where you sort things out with a few people. I'm just a member of this circle too; you talk to me like anyone else. Your messages are encrypted, and you don't need an account.",
    wat_is_dit: 'Onderling is for the everyday: messages, tasks and plans. For your neighbourhood, your household or a club. Small and manageable.',
    own_circle: {
      ask: 'Want to start a circle of your own?',
      options: { ja: 'Yes, help me', later: 'Not right now' },
    },
    uitnodigen: 'Fine. Once you have a circle, you can invite neighbours or housemates with a link or a QR code. You can also do that later.',
    klaar: "That's it. I'll stay right here — just ask if there's anything you'd like to know.",
  },
});

/** The languages the bundled copy covers. */
export const ONBOARDING_LANGS = Object.freeze(Object.keys(COPY));
export const DEFAULT_ONBOARDING_LANG = 'nl';

/**
 * Resolve the bundled onboarding template for a language (falls back to Dutch for an
 * unknown lang). Returns a frozen, engine-ready template: each `say`/`ask` string and
 * every option `{ value, label }` filled from `COPY[lang]`, the flow from `FLOW`.
 *
 * @param {string} [lang]  'nl' | 'en' (default 'nl')
 * @returns {object} a template consumable by startGuidedSetup / submitGuidedStep / stepOf
 */
export function buildOnboardingTemplate(lang = DEFAULT_ONBOARDING_LANG) {
  const copy = COPY[lang] ?? COPY[DEFAULT_ONBOARDING_LANG];
  const steps = {};
  for (const [id, def] of Object.entries(FLOW.steps)) {
    const c = copy[id];
    if (def.kind === 'choice') {
      const labels = (c && typeof c === 'object' && c.options) || {};
      steps[id] = {
        ask: (c && c.ask) || id,
        kind: 'choice',
        ...(def.sets ? { sets: def.sets } : {}),
        options: def.options.map((o) => ({
          value: o.value,
          label: labels[o.value] ?? o.value,
          ...(o.next !== undefined ? { next: o.next } : {}),
          ...(o.handoff !== undefined ? { handoff: o.handoff } : {}),
        })),
      };
    } else {
      steps[id] = {
        say: typeof c === 'string' ? c : (c?.say ?? id),
        ...(def.next !== undefined ? { next: def.next } : {}),
      };
    }
  }
  return Object.freeze({ id: FLOW.id, version: FLOW.version, start: FLOW.start, steps });
}

/** The bundled default (Dutch) onboarding template. Remote templates override it. */
export const DEFAULT_ONBOARDING_TEMPLATE = buildOnboardingTemplate(DEFAULT_ONBOARDING_LANG);

/**
 * Load an onboarding template, preferring a remote (HQ-updatable) one and falling back
 * to the bundled build for `lang`. Mirrors `loadSettingsTemplate` — `fetch` is injected
 * for testability; an invalid/failed remote yields the bundled fallback.
 *
 * @param {object} [args]
 * @param {string}   [args.url]        remote template URL
 * @param {Function} [args.fetchImpl]  defaults to global fetch
 * @param {string}   [args.lang]       fallback language (default 'nl')
 * @param {object}   [args.fallback]   explicit fallback template (defaults to the bundled build for `lang`)
 */
export async function loadOnboardingTemplate({
  url,
  fetchImpl = globalThis.fetch,
  lang = DEFAULT_ONBOARDING_LANG,
  fallback,
} = {}) {
  const bundled = fallback ?? buildOnboardingTemplate(lang);
  if (!url || typeof fetchImpl !== 'function') return bundled;
  try {
    const res = await fetchImpl(url);
    const json = await res.json();
    return isValidTemplate(json) ? json : bundled;
  } catch {
    return bundled;
  }
}
