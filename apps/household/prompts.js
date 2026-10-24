/**
 * prompts.js — the household manifest's background for the shared assistant engine (`systemPrompt`).
 *
 * Versioned: bumping `PROMPT_VERSION` is a deliberate act.
 */

export const PROMPT_VERSION = 4;

/**
 * The household app's BACKGROUND for the shared assistant engine (the manifest's `systemPrompt`).
 *
 * v4 (2026-09-28) — background only. The engine's own prompt says how to act, when to ask and how to answer chat;
 * this adds what the household's lists mean. It used to carry its own protocol too ("Default to NOISE … reply the
 * literal single word: noise") beside the engine's "reply briefly and naturally", and the model, handed both, fell
 * silent on a greeting or an out-of-scope question. (The protocol's standalone agent retired 2026-10-24.)
 */
export const SYSTEM_PROMPT_CLASSIFY = `Household background. A small group of people share a household and chat in Dutch or English. Its lists hold what they need to buy, do, fix or plan.

How to choose the type for addItem:
- shopping = something the household needs to BUY (groceries, supplies).
  Examples: "we need bread", "add milk", "can someone get tomato passata?".
- errand = something to DO that isn't a repair or a purchase.
  Examples: "pick up dry cleaning", "drop kids at school", "do the dishes",
  "kan iemand de afwas doen" (Dutch: someone please do the dishes).
- repair = something broken that needs fixing.
  Examples: "the tap is broken", "de wasmachine is stuk".
- schedule = a calendar event or appointment.
  Examples: "dentist Friday 14:00", "school pickup 17:00".

How to recognise markComplete — the member is REPORTING that an item is finished:
- "I bought <X>" / "got the <X>"
- "<X> is done" / "finished <X>"
- "ik heb <X> gekocht" / "<X> is klaar" / "<X> is gekocht"
Match what they reference: { match: "<short keyword from their message>" }.

help() is for an explicit request for help or the command list, never for a greeting.
Keep tool args short and verbatim from the member's text — Dutch stays Dutch.`;

/**
 * The prompt the STANDALONE household agent (`HouseholdAgent`, `classifyAndExtract`) was built against: the full
 * v3 text, with its tool list and its "noise" protocol, which that agent parses. Not used by the shared engine.
 *
 * v2 (2026-05-01) — tightened after the v1 smoke test:
 *  - Examples for shopping-vs-errand boundary
 *  - "I bought X" / "X is done" → markComplete
 *  - Greetings + small-talk → noise (NOT help)
 *  - help ONLY when explicitly asked
 *  - Default to noise when unsure
 *
 * We're optimising for **precision over recall**.  A missed
 * extraction is mildly annoying; a wrong extraction creates fake
 * household items the user has to clean up.
 */
