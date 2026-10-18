/**
 * localWireFitness — the `local ≡ wire` equivalence + route-parity fitness
 * harness (Workstream B, decision #5 "one uniform route over one pure core").
 *
 * The uniform-route invariant is: a function is ONE pure core
 * `(store, args, ctx) → result`, reachable two ways that MUST agree —
 *   • LOCAL route — the core called directly over its store (an app's
 *     `Service.callSkill`, no synthetic envelope), and
 *   • WIRE route  — the same core wrapped by `wireSkill` + registered as a
 *     `defineSkill`, invoked through the serialized `{parts:[DataPart], from,
 *     envelope}` path on a REAL agent.
 *
 * This module is framework-agnostic (it takes `{ describe, it, expect }` so
 * `@onderling/sdk` needn't depend on a test runner) and **parameterized by app**,
 * so household / pinboard / tasks-v0 each drive it with a tiny config. It asserts:
 *
 *   1. EQUIVALENCE — for each representative case, running it via the LOCAL
 *      invoker and via the WIRE invoker yields the same result once volatile
 *      fields (ids, timestamps, per-route actor identity, sync envelopes) are
 *      normalized away.
 *   2. PARITY — the extracted-core id set, the wire-registration id set, and the
 *      manifest-op id set line up: every core maps to a declared manifest op AND
 *      is registered on the wire route (so an op can't exist on one route but
 *      not the other — anti-drift invariant #3).
 */

/**
 * Keys whose values are legitimately volatile ACROSS the two routes (generated
 * ids, wall-clock stamps, the per-route caller identity, staleness envelopes)
 * and so are stripped before an equivalence comparison.
 */
export const DEFAULT_VOLATILE_KEYS = Object.freeze([
  // identity / generated ids + etags
  'id', 'ids', 'requestId', 'itemId', 'threadId', 'syncedFromId', 'etag', '_etag', 'rev',
  // wall-clock stamps
  'createdAt', 'updatedAt', 'addedAt', 'completedAt', 'claimedAt', 'submittedAt',
  'approvedAt', 'rejectedAt', 'revokedAt', 'ts', 'timestamp',
  // per-route actor identity (LOCAL uses the test webid; WIRE uses the agent key)
  // — every "who did it" field, since the caller differs by construction.
  'addedBy', 'claimedBy', 'completedBy', 'submittedBy', 'approvedBy', 'rejectedBy',
  'revokedBy', 'reassignedBy', 'assignee', 'actor', 'by', 'master', 'owner',
  'previousAssignee',
  // sync / staleness envelopes
  '_sync', 'lastSyncAt', 'lastSync', '_lastSync', 'source',
]);

/**
 * Deep-clone `value` (via JSON, so `undefined`/functions/Dates already agree
 * with what the wire route serializes) and recursively delete volatile keys.
 *
 * @param {*} value
 * @param {string[]} [extra] extra keys to strip for a specific op
 * @returns {*}
 */
export function stripVolatile(value, extra = []) {
  const drop = new Set([...DEFAULT_VOLATILE_KEYS, ...extra]);
  const clone = value === undefined ? null : JSON.parse(JSON.stringify(value));
  const walk = (v) => {
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out = {};
      for (const [k, val] of Object.entries(v)) {
        if (drop.has(k)) continue;
        out[k] = walk(val);
      }
      return out;
    }
    return v;
  };
  return walk(clone);
}

/**
 * Compute the route-parity diff between the three id sets.
 *
 * @param {object} sets
 * @param {string[]} sets.coreIds        ids with an extracted pure core
 * @param {string[]} sets.registeredIds  ids registered on the wire route (buildSkills output)
 * @param {string[]} sets.manifestOpIds  ids declared as operations in the manifest
 * @returns {{ ok: boolean, coreMissingManifestOp: string[], coreMissingWireReg: string[] }}
 */
export function diffRouteParity({ coreIds, registeredIds, manifestOpIds }) {
  const reg = new Set(registeredIds);
  const man = new Set(manifestOpIds);
  const coreMissingManifestOp = coreIds.filter((id) => !man.has(id));
  const coreMissingWireReg    = coreIds.filter((id) => !reg.has(id));
  return {
    ok: coreMissingManifestOp.length === 0 && coreMissingWireReg.length === 0,
    coreMissingManifestOp,
    coreMissingWireReg,
  };
}

/**
 * Register the parameterized fitness suite for one app.
 *
 * @param {object} config
 * @param {string} config.app                       app label (test title)
 * @param {string[]} config.coreIds                 Object.keys(<APP>_CORES)
 * @param {string[]} config.registeredIds           ids from the app's buildSkills output
 * @param {string[]} config.manifestOpIds           ids of the manifest's operations
 * @param {() => ((op: string, args?: object, ctx?: object) => Promise<*>)} config.makeLocalInvoker
 *        builds a FRESH local environment; returns an invoker that calls the
 *        pure core directly (typically `createXService().callSkill`).
 * @param {() => Promise<{ invoke: (op: string, args?: object, ctx?: object) => Promise<*>, stop?: () => Promise<void> }>} config.makeWireInvoker
 *        builds a FRESH real agent with the wire skills registered; `invoke`
 *        goes through the serialized parts path and returns the unwrapped data.
 * @param {Array<{ name: string, run: (invoke: Function) => Promise<*>, volatile?: string[] }>} config.cases
 *        representative op sequences; `run` receives an invoker and returns the
 *        result to compare. Chaining setup ops inside `run` keeps per-route ids
 *        self-consistent (e.g. addTask → claimTask by the returned id).
 * @param {{ describe: Function, it: Function, expect: Function }} deps  test-runner primitives
 */
export function describeLocalWireFitness(config, deps) {
  const { describe, it, expect } = deps;
  const {
    app, coreIds, registeredIds, manifestOpIds,
    makeLocalInvoker, makeWireInvoker, cases = [],
  } = config;

  describe(`${app} — uniform route: local ≡ wire fitness`, () => {
    it('route parity: every core maps to a manifest op AND a wire registration', () => {
      const diff = diffRouteParity({ coreIds, registeredIds, manifestOpIds });
      expect(diff.coreMissingManifestOp,
        `cores without a manifest op: ${diff.coreMissingManifestOp.join(', ')}`).toEqual([]);
      expect(diff.coreMissingWireReg,
        `cores not registered on the wire route: ${diff.coreMissingWireReg.join(', ')}`).toEqual([]);
      expect(coreIds.length).toBeGreaterThan(0);
    });

    for (const c of cases) {
      it(`equivalence: ${c.name} — direct core ≡ serialized wire invoke`, async () => {
        const localInvoke = makeLocalInvoker();
        const localResult = await c.run(localInvoke);

        const wire = await makeWireInvoker();
        let wireResult;
        try {
          wireResult = await c.run(wire.invoke);
        } finally {
          await wire.stop?.();
        }

        expect(stripVolatile(localResult, c.volatile))
          .toEqual(stripVolatile(wireResult, c.volatile));
      });
    }
  });
}
