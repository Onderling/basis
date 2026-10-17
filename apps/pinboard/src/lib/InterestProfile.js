/**
 * InterestProfile — Pinboard Phase 22 (2026-05-06).
 *
 * On-device, per-user "what does this person actually engage with?"
 * matching, layered ON TOP of the deterministic Layer-1 skills
 * matcher.  Pure functions; no I/O, no inference, no network.
 *
 * Idea
 * ────
 * Layer 1 (the host's `matchesMine`: the person's own offerings, the driver matcher) is fast and deterministic:
 * if the post's `categoryId` lines up with one of the user's skills,
 * it's a match.  But Layer 1 misses borderline posts whose body
 * happens to mention things the user has shown interest in before
 * (e.g. they responded to "kun je mijn fietsband plakken?" last
 * week — they probably also care about "iemand die iets weet van
 * versnellingen?" this week, even when it's filed under a different
 * category).
 *
 * Layer 2 fills that gap by scoring posts against a TF-IDF profile
 * built from the bodies of posts the user *responded to*.  No
 * "interest" data is sent over the wire — the profile is computed
 * purely from local interaction history.
 *
 * Cosine over a TF-IDF projection is the simplest thing that works
 * for this scale (a few hundred posts at most).
 *
 *   - `update(profile, body)`              — add a body the user engaged with
 *   - `score(profile, body)`               — cosine ∈ [0,1]; 0 when the
 *                                             profile is empty
 *   - `combinedRelevance(layer1, layer2,
 *        threshold)`                       — Layer 1 wins; otherwise hit
 *                                             when Layer 2 ≥ threshold
 *
 * Storage shape (intentionally trivial — durable persistence is V2;
 * for now apps keep the profile in memory or store it in the
 * MemberMap's `externalIds`):
 *
 *   {
 *     docFrequency: { [token]: number },   // # of bodies token appeared in
 *     totalDocs:    number,
 *     centroidTerm: { [token]: number },   // running TF sum (across docs)
 *     centroidNorm: number | null,         // cached L2 norm of the
 *                                          // tfidf-weighted centroid;
 *                                          // recomputed lazily by score()
 *   }
 *
 * **Substrate candidate (rule of two — first consumer):** when
 * apps/household or apps/archive add personal-interest learning,
 * promote into `@onderling/interest-profile`.  Tracked in
 * `Project Files/Substrates/substrate-candidates.md`.
 */

const STOPWORDS = new Set([
  // very small NL+EN list — keeps the TF-IDF clean without dragging
  // in a corpus
  'de','het','een','en','of','van','voor','met','op','aan','in','om',
  'is','zijn','wil','wilt','willen','heb','heeft','hebben','wordt',
  'wat','wie','waar','hoe','dat','deze','die','dit','niet','wel',
  'mijn','jouw','onze','ik','je','jij','hij','zij','we','wij','ze',
  'the','a','an','and','or','of','for','to','from','with','on','at',
  'is','are','be','am','was','were','do','does','did','have','has',
  'had','what','who','where','how','that','this','these','those',
  'not','no','yes','my','your','our','i','you','he','she','they','we',
]);

/** Tokenise a body the same way Layer 1 does — keep matching consistent. */
function tokenise(text) {
  if (typeof text !== 'string' || !text) return [];
  return text.toLowerCase()
    .split(/[^a-zà-ÿ0-9-]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Build a fresh empty profile. */
export function createProfile() {
  return {
    docFrequency: {},
    totalDocs:    0,
    centroidTerm: {},
    centroidNorm: null,
  };
}

/**
 * Mutating update — record one body as a "the user engaged with this"
 * sample.  Idempotent at the per-call level (a token in the same
 * body is counted once for docFrequency, multiple times for the
 * centroid TF sum — standard TF-IDF semantics).
 */
export function update(profile, body) {
  const tokens = tokenise(body);
  if (tokens.length === 0) return profile;

  const seen = new Set();
  for (const t of tokens) {
    profile.centroidTerm[t] = (profile.centroidTerm[t] ?? 0) + 1;
    if (!seen.has(t)) {
      profile.docFrequency[t] = (profile.docFrequency[t] ?? 0) + 1;
      seen.add(t);
    }
  }
  profile.totalDocs += 1;
  // Invalidate the cached norm.
  profile.centroidNorm = null;
  // Phase 29.2: optional change callback — `InterestProfileCache`
  // attaches one to schedule a debounced write-through.  No-op when
  // absent.
  if (typeof profile._onChange === 'function') {
    try { profile._onChange(profile); } catch { /* persistence is best-effort */ }
  }
  return profile;
}

/**
 * Compute (or return cached) centroid IDF-weighted vector + its L2
 * norm.  Keeping this lazy means score() pays the cost only when
 * called, not on every update.
 *
 * @returns {{ vec: Map<string, number>, norm: number }}
 */
function centroid(profile) {
  const vec = new Map();
  let sumSq = 0;
  for (const [t, tf] of Object.entries(profile.centroidTerm)) {
    const df  = profile.docFrequency[t] ?? 1;
    const idf = Math.log(1 + profile.totalDocs / df);
    const w   = tf * idf;
    vec.set(t, w);
    sumSq += w * w;
  }
  const norm = Math.sqrt(sumSq);
  return { vec, norm };
}

/**
 * Score a candidate post body against the profile using cosine
 * similarity in TF-IDF space.  Returns 0 when the profile is empty
 * or has no overlap.
 */
export function score(profile, body) {
  if (profile.totalDocs === 0) return 0;
  const tokens = tokenise(body);
  if (tokens.length === 0) return 0;

  const { vec, norm } = centroid(profile);
  if (norm === 0) return 0;

  // Build the candidate's TF-IDF projection on the same vocabulary.
  const candTf = new Map();
  for (const t of tokens) candTf.set(t, (candTf.get(t) ?? 0) + 1);

  let dot = 0;
  let candSumSq = 0;
  for (const [t, tf] of candTf) {
    const df  = profile.docFrequency[t] ?? 0;
    if (df === 0) continue;
    const idf = Math.log(1 + profile.totalDocs / df);
    const w   = tf * idf;
    candSumSq += w * w;
    const cw  = vec.get(t);
    if (cw !== undefined) dot += w * cw;
  }
  if (candSumSq === 0) return 0;
  const cosine = dot / (norm * Math.sqrt(candSumSq));
  // Clamp for floating-point sanity.
  if (cosine < 0) return 0;
  if (cosine > 1) return 1;
  return cosine;
}

/**
 * Combine a Layer-1 deterministic decision with a Layer-2 score.
 *
 * Layer 1 wins outright — if the deterministic matcher already says
 * "matched", we keep its reason.  Otherwise we promote a borderline
 * Layer-2 hit (score ≥ threshold) into a `via: 'interest'` match.
 *
 * @param {{matched: boolean, reason?: string, viaCategory?: string, viaTags?: string[]}} layer1
 * @param {number} layer2Score
 * @param {number} [threshold=0.15]
 */
export function combinedRelevance(layer1, layer2Score, threshold = 0.15) {
  if (layer1?.matched) {
    return { ...layer1, layer2Score };
  }
  if (typeof layer2Score === 'number' && layer2Score >= threshold) {
    return {
      matched:    true,
      via:        'interest',
      layer2Score,
    };
  }
  return { matched: false, reason: layer1?.reason ?? 'no-overlap', layer2Score };
}
