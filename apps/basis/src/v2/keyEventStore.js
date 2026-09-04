/**
 * keyEventStore — a per-circle LOCAL log of the group-key events a device holds (the no-pod key-chain carrier).
 *
 * This is the RECEIVE-side counterpart to `@onderling/kring-host` `keyEventLogSink` (the EMIT side): where the
 * sink fans a `group-key-event` to the remaining members on a rotation, THIS store is where a member records
 * every key-event it holds — its OWN emitted copies (via the sink's `recordLocal`) and every event fanned to it
 * by another member (via the `group-key-event` receive handler). A content read then FOLDS the recorded events
 * into the key chain (`foldKeyEvents`/`readKeyChain`), so the member opens exactly the versions it is entitled to
 * and nothing sealed after it was removed — with NO pod, purely from what it received.
 *
 * Kept deliberately small + portable (zero DOM/RN, no transport): the web shell (circleApp.js) and the node
 * harness inject the same store, so web≡mobile record + fold identically (CLAUDE.md invariants #1/#2). Storage is
 * in-memory here (session-scoped, like the per-circle pseudo-pod); durability across reloads is a later step that
 * swaps this Map for a vault-/log-backed implementation behind the same interface.
 */
import { KEY_EVENT_KIND, readKeyChain, openAcrossKeyChain, makeOpener } from '@onderling/pod-client';

/** Group a key-event with no explicit groupId under one bucket, so a store used for a single unnamed circle still works. */
const NO_GROUP = '\u0000nogroup';

/**
 * Create a per-circle key-event log. `record` is DE-DUPED BY VERSION within a circle (a re-issued grant for the
 * same version supersedes — e.g. v1 re-wrapped to one more recipient as the roster grows), so the log never
 * grows without bound and the fold sees exactly one event per version.
 *
 * @returns {{
 *   record: (groupId: (string|null|undefined), event: object) => boolean,
 *   list:   (groupId: (string|null|undefined)) => Array<object>,
 *   all:    () => Array<object>,
 *   has:    (groupId: (string|null|undefined), version: number) => boolean,
 * }}
 */
export function createKeyEventStore() {
  const byGroup = new Map();   // groupKey → Map<version, event>

  const keyFor = (groupId) => (groupId == null ? NO_GROUP : groupId);

  function record(groupId, event) {
    if (!event || event.kind !== KEY_EVENT_KIND || typeof event.sealed !== 'string' || !Number.isInteger(event.version)) {
      return false;   // not a well-formed key-event — ignore (the handler treats false as "not recorded")
    }
    const key = keyFor(groupId ?? event.groupId ?? null);
    let versions = byGroup.get(key);
    if (!versions) { versions = new Map(); byGroup.set(key, versions); }
    versions.set(event.version, event);   // de-dup by version — last wins
    return true;
  }

  function list(groupId) {
    const versions = byGroup.get(keyFor(groupId));
    return versions ? [...versions.values()] : [];
  }

  function all() {
    const out = [];
    for (const versions of byGroup.values()) out.push(...versions.values());
    return out;
  }

  function has(groupId, version) {
    const versions = byGroup.get(keyFor(groupId));
    return !!versions && versions.has(version);
  }

  /**
   * Replace ONE circle's events wholesale — the key-LANE projection's refresh: the store mirrors
   * exactly the verified, dispute-discounted set the lane projects, so a version that a later
   * fork-proof discounts DISAPPEARS here too (an additive record() could never take one back).
   */
  function replaceCircle(groupId, events) {
    byGroup.delete(keyFor(groupId));
    let n = 0;
    for (const e of (Array.isArray(events) ? events : [])) { if (record(groupId, e)) n += 1; }
    return n;
  }

  return { record, list, all, has, replaceCircle };
}

/**
 * Open sealed content by FOLDING the recorded key-events into the member's key chain, then opening across it.
 * The no-pod reader: `readKeyChain` folds the events (`foldKeyEvents`) into the versions this member can unwrap
 * with its `opener` (a `(sealedText) => plaintext` closure bound to the member's sealing PRIVATE key — the key
 * never crosses this boundary), and `openAcrossKeyChain` resolves the content's version by authenticated trial.
 * Throws when no version the member holds opens it — precisely the backward-secrecy denial for content sealed
 * after the member's removal.
 *
 * @param {{sealed:string}|string} env             a seal-resolver envelope or a raw sealed string.
 * @param {object} o
 * @param {Array<object>} o.events                 the member's recorded key-events (e.g. `store.list(groupId)`).
 * @param {string} [o.groupId]                     restrict the fold to one circle's events.
 * @param {(sealedText:string)=>string} o.opener   the member's sealing opener.
 * @returns {string} plaintext
 */
export function openViaKeyEvents(env, { events, groupId, opener } = {}) {
  const chain = readKeyChain(events, { groupId, opener });
  return openAcrossKeyChain(env, chain);
}

/**
 * No-pod defence-in-depth over a circle's content strategy: wrap `open` so content sealed under a group-key
 * version carried in the LOG (a key-event fanned to this device, not the pod key resource) still opens. The
 * pod strategy is tried FIRST and unchanged; only on its miss do we trial the chain folded from the recorded
 * key-events, using this device's per-circle sealing opener. `listEvents` is read lazily at OPEN time, so
 * fans that land after the strategy was cached are still seen. Additive — a circle with no key-events
 * behaves exactly as before, and neither reader opening it surfaces the original (pod) denial.
 *
 * Shared by both shells (invariants #1/#2): web's circleApp and mobile's circlePods wrap the SAME way.
 *
 * @param {{seal:Function, open:Function}} strat   the circle's resolved content strategy.
 * @param {object} o
 * @param {() => Array<object>} o.listEvents       lazy read of the circle's recorded key-events.
 * @param {string} o.groupId                       the circle id (restricts the fold).
 * @param {string} o.privateKey                    this device's per-circle sealing PRIVATE key.
 * @returns {{seal:Function, open:Function}}
 */
export function wrapStrategyWithKeyEventFold(strat, { listEvents, groupId, privateKey, extraChain = null } = {}) {
  if (!strat || typeof listEvents !== 'function' || !privateKey) return strat;
  const opener = makeOpener(privateKey);
  return {
    ...strat,
    open: (text) => {
      try { return strat.open(text); }
      catch (podErr) {
        try { return openViaKeyEvents(text, { events: listEvents(), groupId, opener }); }
        catch {
          // THE HISTORY SIDECAR (the replace ceremony): group-key versions this person absorbed from a
          // retired device's key — raw keys, held locally, read lazily so a ceremony that ran after this
          // strategy was cached is still seen. Last resort; an empty sidecar changes nothing.
          if (typeof extraChain === 'function') {
            try {
              const chain = extraChain();
              if (Array.isArray(chain) && chain.length) return openAcrossKeyChain(text, chain);
            } catch { /* fall through to the original denial */ }
          }
          throw podErr;   // no reader opens it — surface the original (pod) denial
        }
      }
    },
  };
}
