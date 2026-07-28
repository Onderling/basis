/**
 * agents — the DEFAULT catalog source (stub).
 *
 * The curated catalog is a PLUGGABLE SOURCE behind a `{ list, get }`
 * contract; installCores treats it as opaque data. This module ships a
 * local placeholder source so the install surface is exercisable
 * end-to-end before the real catalog exists.
 *
 * ── commons-governance ─────────────────────────────────────────────────
 * The REAL curated source — who may publish, signing keys, review,
 * reputation, the trust badge — is the community-commons governance
 * thread (NOTE-online-agent-surface §3), designed SEPARATELY. This stub
 * hardcodes NO governance: it is an in-memory list of example cards.
 * Swap it for the community source behind the same contract; nothing in
 * installCores changes.
 *
 * An installable entry is an A2A Agent Card (+ `x-onderling`) per
 * SPEC-agents-registry — the same shape `projectAgentCard` emits — so a
 * catalog card and a registry-projection card are interchangeable.
 */

/** Placeholder installable cards. NOT curated — a dev stand-in only. */
export const STUB_CATALOG_CARDS = Object.freeze([
  Object.freeze({
    name:        'Summariser',
    description: 'Summarises long threads and documents on request.',
    url:         'https://example.invalid/agents/summariser',
    version:     '1.0',
    skills: Object.freeze([
      Object.freeze({ id: 'summarise.thread' }),
      Object.freeze({ id: 'summarise.document' }),
    ]),
    authentication: Object.freeze({ schemes: Object.freeze(['Bearer']) }),
    'x-onderling': Object.freeze({
      id:     'catalog:summariser',
      pubKey: 'pub-stub-summariser',
      role:   'service',
    }),
  }),
  Object.freeze({
    name:        'Translator',
    description: 'Translates messages between languages.',
    url:         'https://example.invalid/agents/translator',
    version:     '1.0',
    skills: Object.freeze([
      Object.freeze({ id: 'translate.text' }),
    ]),
    authentication: Object.freeze({ schemes: Object.freeze(['Bearer']) }),
    'x-onderling': Object.freeze({
      id:     'catalog:translator',
      pubKey: 'pub-stub-translator',
      role:   'service',
    }),
  }),
]);

/**
 * createStubCatalog — a `{ list, get }` catalog source over a fixed card
 * list. Keyed by `x-onderling.id` (legacy `x-onderling.id`, then agentId/pubKey).
 *
 * @param {Array<object>} [cards]  installable cards (defaults to the stub set)
 * @returns {{ list: () => Promise<object[]>, get: (id: string) => Promise<object|null> }}
 */
export function createStubCatalog(cards = STUB_CATALOG_CARDS) {
  const idOf = (c) => c?.['x-onderling']?.id ?? c?.agentId ?? c?.['x-onderling']?.pubKey ?? c?.pubKey ?? null;
  const byId = new Map();
  for (const c of cards) {
    const id = idOf(c);
    if (typeof id === 'string' && id.length > 0) byId.set(id, c);
  }
  return {
    async list() { return [...byId.values()]; },
    async get(id) { return byId.get(id) ?? null; },
  };
}
