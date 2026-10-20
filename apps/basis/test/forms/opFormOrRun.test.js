/**
 * Pairing from a scanned code: the code names the address; the circle is picked from the person's own circles — and
 * with one circle there is nothing to pick, so it runs. With several, the form asks only for the circle.
 */
import { describe, it, expect } from 'vitest';
import { opFormOrRun } from '../../src/forms/opFormOrRun.js';
import { SCAN_TARGETS, scanOpResultWords } from '../../src/v2/scanRoute.js';

const target = { app: SCAN_TARGETS.pair.app, id: SCAN_TARGETS.pair.id };
const needs = SCAN_TARGETS.pair.needs('peer-addr');

describe('opFormOrRun — the scanned pair code', () => {
  it('one circle of mine: no question, the op runs with it', async () => {
    const r = await opFormOrRun(target, needs, async () => [{ id: 'thuis', label: 'Thuis' }]);
    expect(r).toEqual({ run: { app: 'household', opId: 'pairCirclePeer', args: { addr: 'peer-addr', circle: 'thuis' } } });
  });
  it('several: a form that asks the circle only, its choices handed along; the address stays filled', async () => {
    const r = await opFormOrRun(target, needs, async () => [{ id: 'thuis', label: 'Thuis' }, { id: 'werk', label: 'Werk' }]);
    expect(r.form.missing).toEqual(['circle']);
    expect(r.form.fields.find((f) => f.name === 'addr')).toMatchObject({ value: 'peer-addr', readOnly: true });
    expect(r.form.fields.find((f) => f.name === 'circle').pickerSource).toMatchObject({ listOp: 'listMyCircles' });
    expect(r.choices.circle.map((c) => c.id)).toEqual(['thuis', 'werk']);
  });
  it('no circle at all: no form (nothing could fill it), said', async () => {
    expect(await opFormOrRun(target, needs, async () => [])).toEqual({ error: 'nothing-to-pick', param: 'circle' });
    expect(scanOpResultWords({ ok: false, outcome: 'nothing-to-pick' })).toEqual({ key: 'circle.scan.pair_no_circle' });
  });
  it('an op nobody declares is said, not guessed', async () => {
    expect(await opFormOrRun({ app: 'household', id: 'nope' }, {}, async () => [])).toEqual({ error: 'unknown-op' });
  });
  it('what the op answered, in words both shells say', () => {
    expect(scanOpResultWords({ ok: true, outcome: 'paired' })).toEqual({ key: 'circle.pairedDevices.paired' });
    expect(scanOpResultWords({ ok: false, outcome: 'not-my-circle' })).toEqual({ key: 'circle.scan.pair_not_mine' });
    expect(scanOpResultWords({ ok: false, outcome: 'failed', error: 'x' })).toEqual({ key: 'circle.scan.pair_failed', params: { error: 'x' } });
  });
});
