/**
 * THE PHONE'S DISK, TOO — the mobile half of "content is sealed at rest".
 *
 * The node-side fitness test (`apps/basis/test/fitness/contentSealedAtRest.test.js`) proves the claim
 * where a file and an agent registry can be read back raw. It cannot reach AsyncStorage, and AsyncStorage
 * is where a phone keeps a circle's store — so a green there and nothing here would be the familiar shape
 * in this repo: one platform proven, the other assumed, and the assumption wrong for months
 * (`CLAUDE.md` invariant #2 — an empty grep on the other shell is a finding, not a clearance).
 *
 * ── What it asserts, and why this shape ─────────────────────────────────────────────────────────
 * Not "the secret word is absent": a circle's store opens with KEY MATERIAL — the group-key resource the
 * producer writes at `.keys/group.json` — which is random bytes and has no word to search for. Absence of
 * a word you cannot name proves nothing.
 *
 * So it asserts the STRUCTURE instead, which is the stronger claim anyway: **every value this phone
 * stored is a sealed envelope.** Not "no plaintext I thought to look for" but "nothing here that is not
 * ciphertext". A store that later writes something in the clear fails, whatever that something is, and a
 * new kind of row is covered without the test being told about it.
 *
 * The mock AsyncStorage keeps its Map reachable so the test reads what was STORED rather than what the
 * store hands back. That distinction is the whole test: reading through the store would open the envelope
 * and prove nothing; reading the Map is reading the phone.
 */
import { describe, it, expect } from 'vitest';
import { initCirclePods, ensureCirclePod } from '../src/core/circlePods.js';
import { useTestContentSeal } from './support/contentSeal.js';

useTestContentSeal();

/** The sealed-envelope prefix every `fp1:` envelope carries (`packages/pod-client/.../envelope.js`). */
const SEALED = 'fp1:';

/** A mock AsyncStorage that lets the test look at the raw bytes, the way a copied phone backup would. */
function inspectableAsyncStorage() {
  const m = new Map();
  return {
    raw: m,
    getItem:    async (k) => (m.has(k) ? m.get(k) : null),
    setItem:    async (k, v) => { m.set(k, String(v)); },
    removeItem: async (k) => { m.delete(k); },
    getAllKeys: async () => [...m.keys()],
  };
}

describe('a phone stores a circle sealed', () => {
  it('every value written to AsyncStorage is an envelope, not content', async () => {
    const storage = inspectableAsyncStorage();
    initCirclePods(storage);

    // Opening a sealed circle is itself a write: the producer puts the group-key resource on this
    // circle's own AsyncStorage-backed store. That is the path the launcher takes on a real phone.
    const producer = await ensureCirclePod('circle-rn-seal', { storagePosture: 'p2' });
    expect(producer, 'the circle producer did not build — the rest of this test would be vacuous').toBeTruthy();

    const rows = [...storage.raw.entries()];
    expect(rows.length, 'nothing reached AsyncStorage — the probe cannot prove anything').toBeGreaterThan(0);

    // A backend row arrives wrapped in its own record (`{"bytes": "fp1:…", "etag": …}`) while a vault row
    // is the sealed string itself, so the payload is what must be checked. Testing the whole record
    // string would have called a correctly sealed row bare — which it did, on the first run.
    const payloadOf = (v) => {
      const text = String(v);
      if (!text.startsWith('{')) return text;
      try { const rec = JSON.parse(text); return typeof rec?.bytes === 'string' ? rec.bytes : text; }
      catch { return text; }
    };
    // The claim, per row so a failure names the offender rather than just saying "somewhere".
    const bare = rows.filter(([, v]) => !payloadOf(v).startsWith(SEALED)).map(([k]) => k);
    expect(bare, `these rows are on the phone unsealed: ${bare.join(', ')}`).toEqual([]);
  }, 60_000);
});
