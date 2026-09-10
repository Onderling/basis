/**
 * The shell's handle on the device's content-at-rest key.
 *
 * `realAgent` mints the key at boot (it is the only place that holds the sealed vault it lives in), but the
 * stores that need it are built in the SHELLS: the web app constructs its search index at module scope,
 * and both shells build a circle's item store the moment a circle is opened. So the key is PUBLISHED here
 * at boot and READ lazily at first use — which works because every backend call is already async.
 *
 * One shared source, so web and mobile seal by construction rather than by both remembering to (invariant
 * #2/#3). A store wrapped through `sealedLocalBackend` is sealed on both platforms or on neither, and the
 * guard that keeps it that way greps for exactly this call.
 *
 * ── Why a module-level holder is right HERE and would be wrong in the agent ─────────────────────────
 * A shell is one app instance with one person and one key, so "the current device's content key" is a
 * genuinely global fact for it. The AGENT deliberately does not read this: it takes its strategy as a
 * local value, because a test process routinely boots several agents and a shared holder would hand the
 * second one's key to the first one's stores. Shells never do that; test processes always do.
 */
import { createSealingBackend, PLAINTEXT_AT_REST } from '@onderling/pseudo-pod';

let current = null;

/**
 * Publish this device's content-seal strategy. Called once by `realAgent` during boot.
 * @param {{seal:Function, open:Function}|null} strategy
 */
export function setShellContentSeal(strategy) {
  if (strategy === PLAINTEXT_AT_REST) { current = PLAINTEXT_AT_REST; return; }   // the person opted out
  current = (strategy && typeof strategy.seal === 'function' && typeof strategy.open === 'function') ? strategy : null;
}

/** This device's content-seal strategy, or null before boot has reached it. */
export function shellContentSeal() {
  return current;
}

/**
 * Wrap a local StorageBackend so what it writes is sealed at rest.
 *
 * Use this at EVERY local backend construction in a shell — the circle item store, the search index, the
 * device-log snapshot, the circle cache. It is deliberately the same call on both platforms so a reviewer
 * can see at a glance which stores are covered and a guard can prove it.
 *
 * @param {object} backend  a `StorageBackend` (IndexedDB on web, AsyncStorage on mobile, memory in tests)
 * @returns {object} the same port, sealed
 */
export function sealedLocalBackend(backend) {
  return createSealingBackend({ backend, getStrategy: () => shellContentSeal() });
}

/**
 * Wrap the per-circle KEY vault so what it holds is sealed at rest.
 *
 * ── What was found, 2026-09-10 ──────────────────────────────────────────────────────────────────
 * The vault at `cc-circle-pod` holds, in its own comment's words, "per-circle sealing identities +
 * controller keys + the persisted group-key resource". It was created in the SHELLS — `VaultIndexedDB`
 * on web, `VaultAsyncStorage` on mobile — and so never passed through `realAgent`'s `sealedVault()`,
 * which is what seals every vault that agent owns. Nothing sealed it. Read back raw, its rows are:
 *
 *     cc.circle-sealing-id:<circle>     {"publicKey":"MCowBQ…","privateKey":"MC4CAQAw…"}
 *     cc.circle-controller-key:<circle> {"publicKey":"MCowBQ…","privateKey":"MC4CAQAw…"}
 *     cc.circle-groupkey:<circle>       {"v":1,"members":2,"recipients":[…]}
 *
 * Two PRIVATE KEYS per circle, in the clear, next to the group key they unwrap.
 *
 * This mattered more than it looked, because it undercut the sealing beside it: content was being sealed
 * at rest on the same device where the keys that open it lay readable. Someone holding the disk did not
 * need to break the seal — the keys were next to it. The at-rest work is only worth what its weakest row
 * is worth, and this was the weakest row.
 *
 * ── The one difference from the content path: this one RESEALS ──────────────────────────────────
 * Content deliberately does not migrate (Frits: *"sealed, but from the start"*) — a pass over live data is
 * the part that could lose someone's things. Key material is the opposite case and gets the opposite
 * treatment: there are three small rows per circle, they are read on every circle open, and a plaintext
 * private key left behind does not merely fail to protect new writes — it opens everything in that circle
 * for as long as it exists, past and future. So a plaintext value found on read is written back sealed.
 *
 * It cannot lose anything: the plaintext is only replaced after a successful seal, and a crash in between
 * leaves exactly what is there today. It needs no boot pass and no enumeration, and it converges on its
 * own, because a key nobody reads is a key nobody is using.
 */
export function sealedLocalVault(vault) {
  if (!vault || typeof vault.get !== 'function' || typeof vault.set !== 'function') {
    throw new Error('sealedLocalVault: a vault with get/set is required');
  }
  const strategy = () => shellContentSeal();

  const wrapped = {
    async set(key, value) {
      const s = strategy();
      if (s === PLAINTEXT_AT_REST) return vault.set(key, value);
      if (!s) throw new Error(`sealedLocalVault: refusing to store "${key}" unsealed — no content key yet`);
      return vault.set(key, s.seal(typeof value === 'string' ? value : JSON.stringify(value)));
    },

    async get(key) {
      const stored = await vault.get(key);
      if (stored == null) return null;
      const s = strategy();
      if (!s || s === PLAINTEXT_AT_REST) return stored;
      let opened;
      try { opened = s.open(String(stored)); }
      catch (err) {
        console.warn(`[at-rest] ${key}: a circle key is stored here that this device cannot open`, err);
        return null;
      }
      // Written before sealing began: seal it now, on the way past. See the header for why key material
      // gets this and content does not.
      if (opened === String(stored)) {
        try { await vault.set(key, s.seal(opened)); }
        catch { /* best-effort — the value is still readable either way */ }
      }
      return opened;
    },
  };

  return new Proxy(vault, {
    get(target, prop, receiver) {
      if (prop in wrapped) return wrapped[prop];
      const v = Reflect.get(target, prop, receiver);
      return typeof v === 'function' ? v.bind(target) : v;
    },
  });
}
