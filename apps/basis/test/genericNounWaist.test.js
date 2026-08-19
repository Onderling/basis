/**
 * §1b END-TO-END through the real waist — "declare a noun → get CRUD free", LIVE + GATED.
 *
 * Ties 1c (catalogue synth) + 1d (real-agent generic decode) + 1b (gate) together over the ACTUAL dispatch
 * chain a typed slash command flows through — no mocks of the waist:
 *   parseInput('/add-note …')  →  resolveDispatch (finds the SYNTH op in the merged catalogue)
 *     →  checkCapability (gate authorises by atom×noun via the synth op's verb/appliesTo)
 *     →  scopeReadyDispatch (injects the active circle for the CREATE verb)
 *     →  runDispatch → agent.callSkill (decodes the __generic op-id) → householdService.callCapability
 *     →  createGenericAtomHandlers over the per-circle CircleItemStore.
 * The household manifest declares an op-LESS `note` noun; this proves it is storable + gate-able + slash-
 * reachable at once (docs/architecture.md L84) with ZERO note handler code.
 */
import { describe, it, expect } from 'vitest';
import { mergeManifests, parseInput, resolveDispatch, scopeReadyDispatch, runDispatch } from '../src/index.js';
import { effectiveCapabilities, checkCapability } from '../src/v2/capabilityGate.js';
import { encodeGenericOpId } from '@onderling/app-manifest';

import { householdManifest } from '../../household/manifest.js';
import { createRealHouseholdAgent } from '../src/web/realAgent.js';

const catalogue    = mergeManifests([{ manifest: householdManifest }]);
const genericAdd = encodeGenericOpId('household', 'add', 'note');   // '__generic__:household:add:note'
const sources    = [{ manifest: householdManifest }];

describe('§1b generic noun through the waist', () => {
  it('1c: `/add-note …` parses + resolves to the synthetic generic op-id (no handler, yet reachable)', () => {
    const dispatch = resolveDispatch(parseInput('/add-note buy stamps', catalogue, { threadId: 't1' }), catalogue);
    expect(dispatch.kind).toBe('ready');
    expect(dispatch.opId).toBe(genericAdd);
    expect(dispatch.appOrigin).toBe('household');
    expect(dispatch.args.body).toBe('buy stamps');
  });

  it('1b: the gate authorises the generic op when household is enabled, denies it when the app is off', () => {
    const op  = catalogue.opsById.get(genericAdd).op;
    const on  = effectiveCapabilities(sources, { apps: ['household'] });
    const off = effectiveCapabilities(sources, { apps: ['calendar'] });   // household disabled
    expect(checkCapability({ op, appOrigin: 'household', args: { body: 'x' } }, on).allow).toBe(true);
    expect(checkCapability({ op, appOrigin: 'household', args: { body: 'x' } }, off))
      .toMatchObject({ allow: false, code: 'app-disabled' });
  });

  it('1d: runDispatch drives the whole chain — the note is stored, then listed, in the active circle', async () => {
    const agent = await createRealHouseholdAgent({ householdViaCircleStore: true, getActiveCircleId: () => 'c1' });
    const run = async (text) => runDispatch(
      scopeReadyDispatch(resolveDispatch(parseInput(text, catalogue, { threadId: 't1' }), catalogue), 'c1'),
      agent.callSkill,
    );

    const added = await run('/add-note buy stamps');
    expect(added.error).toBeUndefined();
    expect(added.payload?.via).toBe('generic');                 // served by the generic handler, not an op
    expect(added.payload?.result?.item?.type).toBe('note');
    expect(added.payload?.result?.item?.body).toBe('buy stamps');

    const listed = await run('/list-note');
    expect(listed.error).toBeUndefined();
    expect(listed.payload?.via).toBe('generic');
    expect(listed.payload?.result?.items?.map((i) => i.body)).toContain('buy stamps');
  });

  it('the synth pass adds the generic op ALONGSIDE real ops, never shadowing them (regression)', () => {
    expect(catalogue.opsById.has('addItem')).toBe(true);            // real household op still present…
    expect(catalogue.opsById.get('addItem').op.verb).toBe('add');
    expect(catalogue.opsById.has(genericAdd)).toBe(true);           // …and the synth op sits beside it
    expect(catalogue.opsById.get(genericAdd).op.__generic).toEqual({ app: 'household', atom: 'add', noun: 'note' });
  });
});
