/**
 * G-S3 — FLOW INTEGRITY: a manifest's declared flows describe machines that actually exist.
 *
 * A flow declaration (`manifest.flows[]`, first one: stoop's `joinGroup`) is a promise in three
 * parts, and each has its own way of silently going false:
 *
 *   1. **declared steps ≡ exported steps** — the state module (`joinGroupState.js`) exports
 *      `JOIN_FLOW_STEPS`; if someone adds a wizard step and forgets the declaration (or renames a
 *      declared step and not the machine's), the manifest advertises a flow that is not the flow.
 *   2. **acyclicity + reachability** — the `next` chain from the first step must visit every step
 *      exactly once and end at `null`. A cycle is a wizard that cannot finish; an unreachable step
 *      is a declared stage no user can arrive at (exactly the inert-seam class, one level up).
 *   3. **the op exists** — `flow.opId` must be declared in the SAME manifest's operations, or the
 *      flow is reachable from nowhere (the twin-reachability rule, applied to flows).
 *
 * Generic over every app manifest that carries `flows` — a second flow is covered the day it is
 * declared. The per-flow exported-steps equivalence is looked up in EXPORTED_STEPS below; a flow
 * with no entry there fails, because a declaration nothing pins is a declaration free to drift.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

/** flowId → async loader of the state module's exported step list. */
const EXPORTED_STEPS = {
  joinGroup: async () =>
    (await import(pathToFileURL(path.join(ROOT, 'apps/basis/src/core/wizards/joinGroupState.js')).href))
      .JOIN_FLOW_STEPS,
};

async function manifestsWithFlows() {
  const out = [];
  for (const app of readdirSync(path.join(ROOT, 'apps'))) {
    const p = path.join(ROOT, 'apps', app, 'manifest.js');
    if (!existsSync(p)) continue;
    let mod;
    try { mod = await import(pathToFileURL(p).href); } catch { continue; }   // shell-only manifests may not load in node
    const manifest = mod.default ?? mod;
    if (Array.isArray(manifest?.flows) && manifest.flows.length) out.push({ app, manifest });
  }
  return out;
}

describe('G-S3 — flow integrity', () => {
  it('at least one flow is declared (the join wizard — batch 6 landed it)', async () => {
    const all = await manifestsWithFlows();
    expect(all.flatMap(({ manifest }) => manifest.flows).map((f) => f.id)).toContain('joinGroup');
  });

  it('every declared flow: unique step ids, acyclic + fully-reachable next chain, opId declared', async () => {
    for (const { app, manifest } of await manifestsWithFlows()) {
      const opIds = new Set((manifest.operations ?? []).map((o) => o.id));
      for (const flow of manifest.flows) {
        expect(flow.id, `${app}: a flow needs an id`).toBeTruthy();
        expect(Array.isArray(flow.steps) && flow.steps.length > 0,
          `${app}/${flow.id}: a flow with no steps declares nothing`).toBe(true);

        const ids = flow.steps.map((s) => s.id);
        expect(new Set(ids).size, `${app}/${flow.id}: duplicate step ids`).toBe(ids.length);

        // Walk the chain from the FIRST step; it must hit every step once and end at null.
        const byId = new Map(flow.steps.map((s) => [s.id, s]));
        const visited = [];
        let cur = flow.steps[0];
        while (cur) {
          expect(visited.includes(cur.id), `${app}/${flow.id}: cycle at "${cur.id}"`).toBe(false);
          visited.push(cur.id);
          if (cur.next == null) break;
          const nxt = byId.get(cur.next);
          expect(nxt, `${app}/${flow.id}: step "${cur.id}" points at unknown "${cur.next}"`).toBeTruthy();
          cur = nxt;
        }
        expect(visited.sort(), `${app}/${flow.id}: unreachable step(s)`).toEqual([...ids].sort());

        expect(opIds.has(flow.opId),
          `${app}/${flow.id}: opId "${flow.opId}" is not declared in this manifest — a flow reachable from nowhere`)
          .toBe(true);
      }
    }
  });

  it('declared steps ≡ the state module\'s exported steps (nothing pins a drift-free declaration but this)', async () => {
    for (const { app, manifest } of await manifestsWithFlows()) {
      for (const flow of manifest.flows) {
        const load = EXPORTED_STEPS[flow.id];
        expect(load, `${app}/${flow.id}: no exported-steps entry in flowIntegrity.test.mjs — add one; `
          + 'a declaration nothing pins is a declaration free to drift').toBeTruthy();
        const exported = await load();
        expect(flow.steps.map((s) => ({ id: s.id, next: s.next })),
          `${app}/${flow.id}: the manifest declaration and the state module disagree`)
          .toEqual(exported.map((s) => ({ id: s.id, next: s.next })));
      }
    }
  });
});
