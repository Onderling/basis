// helpAnswer.js — the pure, offline help-answer engine behind the standing
// help Q&A. It ports the onderling.org site matcher (the two deterministic,
// no-network layers) so answers stay identical across the site and the app:
//
//   layer 0 — word rules: self-referential questions ("who are you?", "where
//             does my question go?") and greetings, matched by regex first.
//   layer 1 — tag/heading overlap: score each card on how many query words hit
//             its per-language tags (and an exact heading word), function words
//             stoplisted; the best card wins if it clears the threshold.
//
// There is NO layer 2 here. A miss returns null — that null is exactly where a
// caller may later offer the consent-gated language-model fallback. The engine
// itself never calls a network or a model; it only ever returns human-written
// cards, with a transparency source label saying so.
//
// Pure: no DOM, no network, no storage. answerHelp(query, { lang }) is the
// whole surface; helpTopics({ lang }) lists the answerable headings.

import { helpDeck } from './kaartjes.js';

// Layer-0 word rules, per language. A rule maps a query pattern to a card id,
// or to '@opening' for the bare greeting. Ported verbatim from the site matcher.
const RULES = {
  nl: [
    [/\b(deze|mijn|m'n) vraag\b|waar gaat .*vraag/, 'veilig.dezevraag'],
    [/wie ben (jij|je)\b|wat ben (jij|je)\b|ben (jij|je) een (bot|ai|mens)/, 'meta.bot'],
    [/^(hoi|hallo|hey|hee|goedemorgen|goedemiddag|goedenavond|dag)[!. ]*$/, '@opening'],
  ],
  en: [
    [/\b(this|my) question\b|where does .*question go/, 'veilig.dezevraag'],
    [/who are you|what are you\b|are you a (bot|an ai|human)/, 'meta.bot'],
    [/^(hi|hello|hey|good (morning|afternoon|evening))[!. ]*$/, '@opening'],
  ],
};

// Function words that made every question look like every card — stoplisted
// before scoring. Ported verbatim from the site matcher.
const STOP = {
  nl: ('de het een en of te dat dit deze die is zijn ben bent was wat wie hoe waar welke wanneer ' +
       'ik jij je u we wij jullie ze zij mijn jouw er kan kun kunnen moet moeten mag mogen wil willen ' +
       'wordt worden gaat gaan doet doen heeft hebben had niet wel ook nog al naar van voor met over aan als bij op in uit om dan zo').split(' '),
  en: ('the a an and or of to for with about at as also on by in out is are am was were be been do does did ' +
       'what who how where why which when i you we they my your it its can could must may will would want ' +
       'not no yes there this that these those go goes have has had').split(' '),
};

function createMatcher(deck, lang) {
  const stop = STOP[lang];
  function words(s) {
    const norm = s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
    const list = norm.replace(/[^a-z0-9@/*]+/g, ' ').split(' ').filter(Boolean);
    return list.filter((w) => stop.indexOf(w) === -1);
  }
  // exact hit = 2, prefix-stem hit = 1 ("kost" ~ "kosten"), miss = 0.
  // Exact must outrank stem, or "werkt" ~ "werk" ties a real "telefoon".
  function hits(word, list) {
    let stem = 0;
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      if (t === word) return 2;
      if (word.length >= 4 && t.length >= 4 && (t.indexOf(word) === 0 || word.indexOf(t) === 0)) stem = 1;
    }
    return stem;
  }
  // Score every (non-fallback) card on tag/heading overlap with the query, best
  // first. Shared by `match` (the deterministic hit) and `rank` (RAG grounding),
  // so the language-model path grounds on the SAME relatedness the on-device
  // matcher uses — one scoring rule, not two. Cards with score 0 are dropped.
  function scoreCards(q) {
    const qw = words(q);
    const scored = [];
    for (let i = 0; i < deck.kaartjes.length; i++) {
      const k = deck.kaartjes[i];
      if (k.id === deck.fallbackId) continue;
      const tags = k.tags[lang], kw = words(k.kop[lang]);
      let score = 0;
      for (let j = 0; j < qw.length; j++) {
        // tag hit (exact 2 / stem 1) plus an exact heading hit (1) — they
        // stack, so "kost" (stem of kosten) + heading "Wat kost het?" = 2.
        score += hits(qw[j], tags) + (hits(qw[j], kw) === 2 ? 1 : 0);
      }
      if (score > 0) scored.push({ card: k, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored;
  }
  // → { type: 'opening' } | { type: 'kaartje', id, layer } | { type: 'fallback' }
  function match(q) {
    const low = q.toLowerCase();
    const rules = RULES[lang];
    for (let r = 0; r < rules.length; r++) {
      if (rules[r][0].test(low)) {
        return rules[r][1] === '@opening'
          ? { type: 'opening', layer: 0 }
          : { type: 'kaartje', id: rules[r][1], layer: 0 };
      }
    }
    const ranked = scoreCards(q);
    const best = ranked[0];
    return best && best.score >= 2 ? { type: 'kaartje', id: best.card.id, layer: 1 } : { type: 'fallback' };
  }
  return { match, words, scoreCards };
}

function cardById(deck, id) {
  for (let i = 0; i < deck.kaartjes.length; i++) if (deck.kaartjes[i].id === id) return deck.kaartjes[i];
  return null;
}

// The transparency source. kind 'local' = answered on-device from a fixed,
// human-written card, no language model. label mirrors the site badge
// ("answered directly — no language model used"); cardId is the provenance
// (which card), or null for the bare greeting.
function localSource(deck, lang, cardId) {
  return { kind: 'local', label: deck.srcLocal[lang], cardId: cardId };
}

/**
 * answerHelp(query, { lang }) → { text, layer, source } | null
 *
 *   text   — the localized card text (or the greeting), human-written.
 *   layer  — 0 for a word-rule hit, 1 for a tag/heading overlap hit.
 *   source — { kind: 'local', label, cardId } transparency provenance.
 *
 * Returns null when nothing matches (the honest no-answer): the caller decides
 * whether to offer a consent-gated model fallback there.
 */
/** The languages the help deck carries (its cards' `nl` / `en`): a question is read in each. */
export const HELP_LANGS = Object.freeze(['nl', 'en']);

export function answerHelp(query, { lang } = {}) {
  const l = lang === 'en' ? 'en' : 'nl';
  const deck = helpDeck;
  if (typeof query !== 'string' || !query.trim()) return null;

  // A person writes in either language the deck has, whatever the app's is (walk: Dutch questions in an English app
  // all missed): the app's language is read first, then the others; the card is always answered in the app's.
  let m = { type: 'fallback' };
  for (const ml of [l, ...HELP_LANGS.filter((x) => x !== l)]) {
    m = createMatcher(deck, ml).match(query);
    if (m.type !== 'fallback') break;
  }

  if (m.type === 'opening') {
    return { text: deck.opening[l], layer: 0, source: localSource(deck, l, null) };
  }
  if (m.type === 'kaartje') {
    const k = cardById(deck, m.id);
    if (!k) return null;
    return { text: k[l], layer: m.layer, source: localSource(deck, l, k.id) };
  }
  // fallback / no match → null (the consent-gated model fallback lives here).
  return null;
}

/**
 * answerHelpTopic(id, { lang }) → { text, layer, source } | null
 *
 * Resolve a picked topic id DIRECTLY to its card (the deterministic path behind a
 * "pick a topic" chip / slash command), bypassing the query matcher — the same
 * localized text + transparency source `answerHelp` returns for a hit. Excludes the
 * fallback card and any unknown id (→ null).
 */
export function answerHelpTopic(id, { lang } = {}) {
  const l = lang === 'en' ? 'en' : 'nl';
  const deck = helpDeck;
  const k = cardById(deck, id);
  if (!k || k.id === deck.fallbackId) return null;
  return { text: k[l], layer: 1, source: localSource(deck, l, k.id) };
}

/**
 * helpTopics({ lang }) → [{ id, kop }]
 *
 * The answerable topics, as their localized headings — the material a caller
 * builds a slash-command help list or "or pick one" chips from. Excludes the
 * fallback (no-answer) card.
 */
export function helpTopics({ lang } = {}) {
  const l = lang === 'en' ? 'en' : 'nl';
  const deck = helpDeck;
  return deck.kaartjes
    .filter((k) => k.id !== deck.fallbackId)
    .map((k) => ({ id: k.id, kop: k.kop[l] }));
}

/**
 * rankHelpCards(query, { lang, limit }) → [{ id, kop, text, score }]
 *
 * The RAG hook behind the language-model help path: score every answerable card
 * on the SAME tag/heading overlap the deterministic matcher uses, best first, and
 * return the top `limit` as localized `{ id, kop, text }` (with the raw `score`).
 * A card that shares nothing with the query is dropped, so this is `[]` for an
 * out-of-topic question — the caller then falls back to a full-deck digest.
 * Excludes the fallback (no-answer) card. Never calls a network or a model.
 *
 * @param {string} query
 * @param {{ lang?: string, limit?: number, deck?: object }} [opts]
 */
export function rankHelpCards(query, { lang, limit = 4, deck = helpDeck } = {}) {
  const l = lang === 'en' ? 'en' : 'nl';
  if (typeof query !== 'string' || !query.trim()) return [];
  const scored = createMatcher(deck, l).scoreCards(query);
  return scored
    .slice(0, Math.max(0, limit))
    .map(({ card, score }) => ({ id: card.id, kop: card.kop[l], text: card[l], score }));
}

/**
 * likelyHelpTopics(query, { lang, limit }) → [{ id, kop }]
 *
 * The topics a question that matched no card most likely means, best first: every card scored on the SAME tag/heading
 * overlap the matcher uses, in every language the deck has (a card keeps its best score), at most `limit`, headed in
 * the app's language. `[]` when the question shares nothing with any card. Never calls a network or a model.
 */
export function likelyHelpTopics(query, { lang, limit = 5, deck = helpDeck } = {}) {
  const l = lang === 'en' ? 'en' : 'nl';
  if (typeof query !== 'string' || !query.trim()) return [];
  const best = new Map();
  for (const ml of HELP_LANGS) {
    for (const { card, score } of createMatcher(deck, ml).scoreCards(query)) {
      if (score > (best.get(card.id)?.score ?? 0)) best.set(card.id, { card, score });
    }
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(0, limit))
    .map(({ card }) => ({ id: card.id, kop: card.kop[l] }));
}
