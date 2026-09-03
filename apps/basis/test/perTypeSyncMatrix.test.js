/**
 * The PER-TYPE SYNC MATRIX — one item of every canonical type, two real peers, asserted arrival.
 *
 * `docs/architecture.md` §3 closes the data plane with exactly this guard, and until now it did not
 * exist: two of the twenty canonical types had a two-device arrival test (`appTaskFanTwoDevice`,
 * `appListFanTwoDevice`), and the rule they stand for — *"a circle owns one store; whatever the store
 * holds is what syncs to the circle's other members"* — was asserted in prose for the other eighteen.
 *
 * It is TABLE-DRIVEN over `CANONICAL_TYPES` on purpose: adding a canonical type adds its row here
 * automatically, so a type wired to the dictionary but not to the lane cannot pass unnoticed. Each row
 * writes a minimal schema-valid item straight into A's circle store — the GENERIC door every type shares,
 * not an app op — and waits for it in B's. That is the claim under test; an app-specific op would test
 * the app instead.
 *
 * KNOWN-UNBUILT rows are debt, not failures: `NOT_CROSSING_YET` records the types that do not arrive
 * today so the guard fails on a REGRESSION (a crossing type stops) or on a NEW unbuilt type, rather than
 * being permanently red and therefore ignored. Same contract as the codenames baseline: triage it DOWN.
 *
 * All in-process (one shared InternalBus — no NKN, relay or browser).
 *
 * @guard one item of EVERY canonical type, written to a circle store on one device, arrives in the
 *        other device's store — the data plane's rule, made countable instead of asserted
 */
import { describe, it, expect, afterAll } from 'vitest';
import { bootRealAgentNode, connectAgentsOverBus, pairCircle, until, teardown } from './support/pairRealAgents.js';
import { CANONICAL_TYPES } from '@onderling/item-types';

const CIRCLE_ID = 'per-type-matrix';

/**
 * Types that do NOT cross. **Measured 2026-09-03: all twenty do, so this is empty — and that is the
 * point of keeping it.** The rule held for every canonical type; only two of them had ever been checked,
 * so eighteen were true-but-unverified rather than broken. An entry appearing here later is a
 * regression, or a new type wired to the dictionary but not to the lane. Do not grow it.
 */
const NOT_CROSSING_YET = new Set([]);

/** A minimal item that satisfies a canonical schema's `required` list. */
function minimalItem(typeName, schema, i) {
  const out = { type: typeName, id: `matrix-${typeName}-${i}` };
  for (const field of schema.required ?? []) {
    if (field in out) continue;
    const spec = schema.properties?.[field] ?? {};
    if (field === 'createdAt' || field === 'updatedAt') { out[field] = new Date().toISOString(); continue; }
    if (field === 'createdBy' || field === 'updatedBy') { out[field] = 'matrix'; continue; }
    if (spec.const !== undefined) { out[field] = spec.const; continue; }
    switch (spec.type) {
      case 'number': case 'integer': out[field] = 1; break;
      case 'boolean': out[field] = false; break;
      case 'array':   out[field] = []; break;
      case 'object': {
        const inner = {};
        for (const r of spec.required ?? []) {
          const is = spec.properties?.[r] ?? {};
          inner[r] = is.const !== undefined ? is.const
            : is.type === 'number' || is.type === 'integer' ? 1
            : is.type === 'array' ? [] : is.type === 'object' ? {}
            : is.format === 'date-time' ? new Date().toISOString()
            : Array.isArray(is.enum) ? is.enum[0] : `${r}-x`;
        }
        out[field] = inner; break;
      }
      default:
        out[field] = spec.format === 'date-time' ? new Date().toISOString()
          : Array.isArray(spec.enum) ? spec.enum[0]
          : `${field}-x`;
    }
  }
  return out;
}

/**
 * The production inbound step the node harness omits: the shells route peer messages through
 * `connectPeerTransport`, whose `routedOnPeerMessage` calls `householdSync.handleInbound` BEFORE the
 * shell router — that is what drives a fanned item-sync envelope into the receiver's stores. Without it
 * NOTHING ingests on B and every row of this matrix would read as a product gap. (Lifted from the task
 * and list fan twins, which is the point: the matrix must be composed the way they are.)
 */
function wireInboundLikeShell(node) {
  const shellRouter = node._routerRef.fn;
  node._routerRef.fn = (env) => {
    try { if (node.agent.householdSync.handleInbound(env?.from, env?.payload)) return; }
    catch { /* fall through to the shell router */ }
    return shellRouter?.(env);
  };
}

const TYPE_NAMES = Object.keys(CANONICAL_TYPES);

describe('per-type sync matrix (two real peers, the generic store door)', () => {
  let A; let B;
  afterAll(async () => { await teardown(A, B); });

  it('every canonical type either crosses, or is recorded as a known gap', async () => {
    // `taskLane: true` composes the DEVICE LOG — without it there is no emitter and every row would fail
    // for a harness reason rather than a product one. (The repo has paid a day for that mistake once.)
    [A, B] = await Promise.all([
      bootRealAgentNode('A', { taskLane: true }), bootRealAgentNode('B', { taskLane: true }),
    ]);
    await connectAgentsOverBus(A, B);
    await pairCircle(A, B, { groupId: CIRCLE_ID, name: 'Matrix', handle: 'matrix' });
    wireInboundLikeShell(B);

    // Arm the circle's fan on BOTH sides. `circleStoreFor` hands back the store; `ensureCircleSync` is
    // what puts it on the fan-out path — a shell reaches this through its boot/enrol path, and a direct
    // store write without it publishes to nobody.
    await A.agent.ensureCircleSync?.(CIRCLE_ID);
    await B.agent.ensureCircleSync?.(CIRCLE_ID);
    const storeA = A.agent.circleStoreFor(CIRCLE_ID);
    const storeB = B.agent.circleStoreFor(CIRCLE_ID);
    const crossed = [];
    const missing = [];
    const rejected = [];

    for (const [i, name] of TYPE_NAMES.entries()) {
      const draft = minimalItem(name, CANONICAL_TYPES[name], i);
      let written = null;
      try { written = await storeA.put(draft, { by: 'matrix' }); }
      catch (err) { rejected.push(`${name}: ${String(err?.message ?? err).slice(0, 60)}`); continue; }
      const id = written?.id ?? draft.id;
      const seen = await until(async () => (await storeB.list()).find((r) => r.id === id), { timeout: 2500 });
      (seen ? crossed : missing).push(name);
    }

    // The measurement, printed so a change in the matrix is legible in CI output rather than a bare diff.
    console.info(`[per-type matrix] crossed ${crossed.length}/${TYPE_NAMES.length}: ${crossed.join(' ')}`);
    if (missing.length)  console.info(`[per-type matrix] DID NOT CROSS: ${missing.join(' ')}`);
    if (rejected.length) console.info(`[per-type matrix] refused by the store: ${rejected.join(' | ')}`);

    // A type that the store refuses is a schema/harness problem, not a sync gap — surface it separately.
    expect(rejected, 'every canonical type can be written to a circle store').toEqual([]);

    const newlyBroken = missing.filter((t) => !NOT_CROSSING_YET.has(t));
    expect(newlyBroken, 'these types stopped crossing (or are new and never did)').toEqual([]);

    const fixed = [...NOT_CROSSING_YET].filter((t) => crossed.includes(t));
    expect(fixed, 'these now cross — delete them from NOT_CROSSING_YET so the guard holds it').toEqual([]);
  }, 120_000);
});
