/**
 * HybridPodStore — implements the Store interface (Phase 1) on top
 * of a HybridPodOrchestrator.  Drop-in replacement for
 * `InMemoryStore` in `HouseholdAgent`.
 *
 * Phase 2 convergence module.  After this lands, `HouseholdAgent`'s
 * `store` constructor arg can be either an `InMemoryStore` (dev /
 * tests) or a `HybridPodStore` (real deployment) and the rest of the
 * agent doesn't change.
 *
 * Generates ULID-style ids the same way `InMemoryStore` does so the
 * two are observationally equivalent for callers.  The orchestrator
 * is the only thing that knows about pods.
 */

const ULID_TIME_LEN = 10;
const ULID_RAND_LEN = 16;
const ULID_ALPHA    = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';   // Crockford base32

function ulid() {
  const now = Date.now();
  const time = encodeBase32(now, ULID_TIME_LEN);
  const rand = randomBase32(ULID_RAND_LEN);
  return time + rand;
}

function encodeBase32(n, len) {
  let out = '';
  for (let i = 0; i < len; i++) {
    out = ULID_ALPHA[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

function randomBase32(len) {
  const bytes = new Uint8Array(len);
  globalThis.crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) out += ULID_ALPHA[bytes[i] % 32];
  return out;
}

/**
 * @implements {import('../storage/Store.js').Store}
 */
export class HybridPodStore {
  /** @type {import('./HybridPodOrchestrator.js').HybridPodOrchestrator} */
  #orchestrator;

  /**
   * @param {object} args
   * @param {import('./HybridPodOrchestrator.js').HybridPodOrchestrator} args.orchestrator
   */
  constructor({ orchestrator }) {
    if (!orchestrator) throw new Error('HybridPodStore: orchestrator required');
    this.#orchestrator = orchestrator;
  }

  /**
   * @param {{ type, text, addedBy, source, dueAt? }} args
   * @returns {Promise<import('../types.js').Item>}
   */
  async addItem({ type, text, addedBy, source, dueAt }) {
    // A fresh item is unclaimed + open, expressed the rich way: `assignee`
    // and `completedAt` are simply ABSENT (not explicit nulls).
    const item = {
      id:           ulid(),
      type,
      text,
      addedBy,
      addedAt:      Date.now(),
      source,
      ...(dueAt !== undefined ? { dueAt } : {}),
    };
    await this.#orchestrator.addItem(item);
    return { ...item };
  }

  async listOpen(filter) {
    return this.#orchestrator.listOpen(filter ?? {});
  }

  async markComplete(itemId) {
    return this.#orchestrator.markComplete(itemId);
  }

  async remove(itemId) {
    return this.#orchestrator.remove(itemId);
  }

  async getById(itemId) {
    return this.#orchestrator.getById(itemId);
  }
}
