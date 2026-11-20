/**
 * A key that cannot be read at a start stops the boot, writes nothing, and reaches the launcher as words with
 * "try again" (ledger L1115; Fable's review of #1470, section 1).
 *
 * Through the REAL boot the phone runs: `bootAgentBundle` (which wraps every boot error as AGENT_WIRING_FAILED, the
 * typed one in `cause`) over AsyncStorage vaults sealed by `VaultEncrypted`. A first boot writes the keys; a second
 * boot has ONE storage read fail (the content key, the host key, the custody marker) and must reject without a
 * single write; the launcher's decision (`bootFailureNotice`) reads the words and "try again" through the wrap; a
 * third boot, with nothing failing, comes up with the same keys.
 */
import { describe, it, expect } from 'vitest';
import { bootAgentBundle } from '../src/core/agentBundle.js';
import { bootFailureNotice } from '../../basis/src/v2/bootFailure.js';
import { isKeyUnreadable } from '../../basis/src/core/agent/keyUnreadable.js';

const REAL_BOOT = { timeout: 60_000 };

/** AsyncStorage over one Map that outlives "launches"; `failOnce(match)` makes the next matching read throw. */
function storage() {
  const store = new Map();
  let fail = null;
  let writes = 0;
  return {
    store,
    failOnce(match) { fail = match; },
    writes: () => writes,
    async getItem(k) {
      if (fail && fail(k)) { fail = null; throw new Error(`storage read failed: ${k}`); }
      return store.has(k) ? store.get(k) : null;
    },
    async setItem(k, v) { writes += 1; store.set(k, String(v)); },
    async removeItem(k) { writes += 1; store.delete(k); },
    async multiRemove(ks) { writes += 1; for (const k of ks) store.delete(k); },
    async getAllKeys() { return [...store.keys()]; },
  };
}

async function bootOnce(as) {
  const b = await bootAgentBundle({ asyncStorage: as });
  const ids = { host: b.agent?.hostPubKey ?? null, chat: b.agent?.pubKey ?? b.agent?.identity?.chat?.pubKey ?? null };
  await b.dispose?.();
  return ids;
}

// [what, which read fails, whether the first boot stores it] — a root-custody device holds no custody marker (absent
// means root mode), but every boot READS it, and a read that fails must not be taken for "absent"
const CASES = [
  ['the content key', (k) => k.startsWith('cc-chat-id:') && k.includes('content-at-rest-key'), true],
  ['the host key', (k) => k.startsWith('cc-host-id:') && k.includes('agent-privkey'), true],
  ['the custody marker', (k) => k.startsWith('cc-owner-root:') && k.includes('custody-mode'), false],
];

describe('a key that cannot be read at a start (L1115)', () => {
  for (const [what, match, stored] of CASES) {
    it(`${what}: the boot stops, nothing is written, the launcher gets the words and "try again"; the next start is the same device`, REAL_BOOT, async () => {
      const as = storage();
      const first = await bootOnce(as);
      if (stored) expect([...as.store.keys()].some(match), `the first boot wrote ${what}`).toBe(true);
      const before = new Map(as.store);
      const writesBefore = as.writes();

      as.failOnce(match);
      const err = await bootAgentBundle({ asyncStorage: as }).then((b) => { b.dispose?.(); return null; }, (e) => e);
      expect(err, 'the boot must not come up over an unreadable key').toBeTruthy();
      expect(err.code).toBe('AGENT_WIRING_FAILED');   // the phone's wrap, unchanged
      expect(isKeyUnreadable(err)).toBe(true);
      expect(bootFailureNotice(err)).toMatchObject({ key: 'circle.boot_content_unreadable', retry: true });
      expect(as.writes(), 'nothing written by the failed boot').toBe(writesBefore);
      expect(new Map(as.store)).toEqual(before);

      const again = await bootOnce(as);
      expect(again).toEqual(first);
      // the same device: every key entry the first boot wrote is the one the next boot runs on
      const keys = [...before.keys()].filter((k) => /agent-privkey|content-at-rest-key/.test(k));
      expect(keys.length).toBeGreaterThanOrEqual(2);
      for (const k of keys) expect(as.store.get(k), k).toBe(before.get(k));
    });
  }
});
