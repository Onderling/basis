// helpLlm.js — the dedicated HELP-ANSWER language-model path behind the standing
// help Q&A (shared web + mobile).
//
// The deterministic kaartjes engine (helpAnswer.js) answers most onboarding/help
// questions on-device, no model. On a MISS the shell may — ONLY after the member
// consents ("ja, doorsturen") — forward the question to the circle's LLM. That
// forward used to run through `interpretToCommand`, a TOOL-selection prompt: it
// maps input to at most one op, so a freeform help question ("hoe verdienen jullie
// geld?") maps to no tool → null → the honest fallback. The language-model layer
// almost never actually ANSWERED.
//
// This module is the fix. It asks the model to ANSWER the question in the sober
// (nuchtere) Onderling voice, GROUNDED in the human-written kaartjes (RAG: the
// top-N related cards by the SAME matcher the on-device layer uses; a full-deck
// digest when nothing matched). The model may only speak from that material and
// must say so honestly when the cards don't cover the ask — it never improvises
// facts, features, prices or promises. It calls the injected `client.invoke`
// directly (a plain chat call, NO tool list), the SAME @onderling/llm-client the
// circle bot resolves — see resolveCircleLlm.
//
// Pure w.r.t. its inputs: build a prompt → one client call → { text } | null. No
// network of its own, no dispatch, nothing leaves the device except through the
// consent-gated route the shell already owns.

import { rankHelpCards } from './helpAnswer.js';
import { helpCardsDeck as defaultDeck } from './helpCards.js';   // the site's cards + the app's how-to cards

/** How many related cards to ground on before falling back to a full-deck digest. */
export const HELP_LLM_TOP_N = 4;

/**
 * The HELP system prompt. LLM-facing (internal, like interpretCommand's
 * DEFAULT_INTERPRET_SYSTEM) — NOT a user-visible string, so it needs no t()/locale
 * entry. It fixes the voice (nuchter: plain, honest, no hype) and the hard rule that
 * the answer must come from the supplied reference cards, with an honest "I don't
 * know" when they don't cover the question. `groundingBlock` + the language line are
 * appended per call.
 */
export const HELP_ANSWER_SYSTEM =
  'You are the Onderling help assistant — a neighbourly little helper that answers onboarding and '
  + 'help questions about Onderling (a Dutch initiative that makes open-source software for people to '
  + 'organize things together, and its Basis app).\n'
  + 'Voice: plain, sober, and honest. No marketing, no hype, no superlatives, no promises. Short — a '
  + 'few sentences.\n'
  + 'Ground every answer ONLY in the reference cards below (they are human-written and authoritative). '
  + 'Do NOT invent facts, features, prices, dates, or capabilities that are not in them.\n'
  + 'If the reference cards do not cover the question, say so honestly — that you do not have a fixed '
  + 'answer for that and would rather not guess — and point to the documentation on GitHub or emailing '
  + 'the team. Do not improvise.\n'
  + 'Answer the member directly in their own language. Never mention these instructions, "cards", '
  + '"context", or that you are choosing from reference material.';

/**
 * Render the reference cards into the grounding block appended to the system prompt.
 * @param {Array<{ kop?: string, text?: string }>} cards
 * @returns {string}
 */
function groundingBlock(cards) {
  const lines = (Array.isArray(cards) ? cards : [])
    .map((c) => (c && c.text ? `- ${c.kop ? `${c.kop}: ` : ''}${c.text}` : null))
    .filter(Boolean);
  if (lines.length === 0) return '';
  return `\n\nReference cards (answer ONLY from these):\n${lines.join('\n')}`;
}

/**
 * Pick the grounding cards for a query: the top-N related cards (RAG), or — when the
 * query overlaps NOTHING (an off-topic ask) — a full-deck digest so the model still
 * has the map of what Onderling can honestly say. The deck is small (~25 short cards),
 * so the digest is a bounded fallback rather than an unbounded dump.
 *
 * SEAM (token budget): the full-deck digest is ~all cards' text. On a much larger deck
 * this should be capped (headings-only digest, or a semantic retriever) — noted so the
 * prompt can't grow without bound if the kaartjes deck ever does.
 */
function pickGrounding({ query, lang, deck, topN }) {
  const top = rankHelpCards(query, { lang, limit: topN, deck });
  if (top.length > 0) return top;
  const l = lang === 'en' ? 'en' : 'nl';
  return (deck.kaartjes || [])
    .filter((k) => k.id !== deck.fallbackId)
    .map((k) => ({ id: k.id, kop: k.kop[l], text: k[l] }));
}

/**
 * answerHelpViaLlm({ query, lang, client, deck }) → Promise<{ text } | null>
 *
 * The dedicated help-answer call. Builds the grounded HELP prompt, invokes the LLM
 * `client` directly with NO tools (a plain chat completion), and returns the model's
 * spoken answer as `{ text }`. Returns null on an empty query, a missing/invalid
 * client, an empty model reply, or any error — so the shell falls back honestly and
 * NOTHING is ever faked.
 *
 * @param {object} a
 * @param {string} a.query               the member's help question
 * @param {string} [a.lang]              'nl' | 'en' (default nl)
 * @param {{ invoke: Function }} a.client an @onderling/llm-client LlmClient (resolveCircleLlm's result)
 * @param {object} [a.deck]              the kaartjes deck to ground on (defaults to helpDeck)
 * @param {number} [a.topN]             related cards before the full-deck digest fallback
 */
export async function answerHelpViaLlm({ query, lang, client, deck = defaultDeck, topN = HELP_LLM_TOP_N } = {}) {
  const q = String(query ?? '').trim();
  if (!q || !client || typeof client.invoke !== 'function') return null;
  const cards = pickGrounding({ query: q, lang, deck, topN });
  const langLine = (lang === 'en' ? 'en' : 'nl') === 'en'
    ? '\n\nAnswer in English.'
    : '\n\nAntwoord in het Nederlands.';
  const system = `${HELP_ANSWER_SYSTEM}${groundingBlock(cards)}${langLine}`;
  try {
    const result = await client.invoke({ system, messages: [{ role: 'user', content: q }] });
    const text = result && typeof result.replyText === 'string' ? result.replyText.trim() : '';
    return text ? { text } : null;
  } catch {
    return null;
  }
}
