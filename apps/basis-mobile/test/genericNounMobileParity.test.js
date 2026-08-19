/**
 * §1b mobile parity — "declare a noun → get CRUD free" on basis-mobile.
 *
 * Mobile needs NO new production code: it composes the SAME `mergeManifests` (so the synthetic op-less
 * capability ops land in the mobile catalog), dispatches through the SAME `createRealHouseholdAgent` (1d's
 * generic decode), gates with the SAME `checkCapability`, and renders with the SAME `circleReplyText`. This
 * test locks that parity against regression by exercising the MOBILE composition + the exact gate call
 * `CircleLauncherScreen` makes + the shared reply render — all without the RN agent (device verify covers live).
 */
import { describe, it, expect } from 'vitest';
import { encodeGenericOpId } from '@onderling/app-manifest';

import { composeManifests, buildManifestsByOrigin } from '../src/core/composeManifests.js';
import { parseInput, resolveDispatch } from '../../basis/src/index.js';
import { effectiveCapabilities, checkCapability } from '../../basis/src/v2/capabilityGate.js';
import { circleReplyText } from '../../basis/src/v2/circleReply.js';

const catalog    = composeManifests();                       // the real mobile dispatch catalog
const genericAdd = encodeGenericOpId('household', 'add', 'note');
const sources    = Object.values(buildManifestsByOrigin()).map((manifest) => ({ manifest }));

describe('§1b mobile parity — generic `note` via the shared pipeline', () => {
  it('the MOBILE catalog carries the synthetic generic op + its /add-note slash', () => {
    const entry = catalog.opsById.get(genericAdd);
    expect(entry).toBeTruthy();
    expect(entry.appOrigin).toBe('household');
    expect(entry.op.verb).toBe('add');
    expect(entry.op.appliesTo.type).toBe('note');
    expect(entry.op.surfaces?.slash?.command).toBe('/add-note');
    expect(catalog.opsById.has('addItem')).toBe(true);       // real ops not shadowed by the synth pass
  });

  it('the mobile parser resolves `/add-note …` → the generic op-id (same waist as web)', () => {
    const d = resolveDispatch(parseInput('/add-note buy stamps', catalog, { threadId: 't' }), catalog);
    expect(d.kind).toBe('ready');
    expect(d.opId).toBe(genericAdd);
    expect(d.appOrigin).toBe('household');
    expect(d.args.body).toBe('buy stamps');
  });

  it('the mobile gate (gateEntry.op → checkCapability) authorises when household is on, denies when off', () => {
    const op  = catalog.opsById.get(genericAdd).op;          // exactly what CircleLauncherScreen passes
    const on  = effectiveCapabilities(sources, { apps: ['household'] });
    const off = effectiveCapabilities(sources, { apps: ['calendar'] });   // household disabled
    expect(checkCapability({ op, appOrigin: 'household', args: { body: 'x' } }, on).allow).toBe(true);
    expect(checkCapability({ op, appOrigin: 'household', args: { body: 'x' } }, off))
      .toMatchObject({ allow: false, code: 'app-disabled' });
  });

  it('the shared circleReplyText renders the generic reply on mobile too', () => {
    const t = (k, p) => (p ? `${k}:${p.label}` : k);
    const reply = { payload: { ok: true, via: 'generic', atom: 'add', result: { ok: true, item: { type: 'note', body: 'buy stamps' } } } };
    expect(circleReplyText(reply, { verb: 'add', t })).toBe('circle.bot.added:buy stamps');
  });
});
