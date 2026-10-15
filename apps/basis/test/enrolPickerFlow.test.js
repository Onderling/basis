/** The enrol flow carries the picker's choice to the ceremony: `personas` (a list of ids) reaches `enrollDevice`. */
import { describe, it, expect } from 'vitest';
import { createFlowRunner } from '@onderling/app-manifest';
import { householdManifest } from '../../household/manifest.js';
import { ENROL_PERSONAS_PARAM } from '../src/v2/enrollOffer.js';

describe('the enrol flow and the persona picker', () => {
  it('the picked persona ids reach the ceremony as a list', async () => {
    const FLOW = householdManifest.flows.find((f) => f.id === 'enroll-device');
    const OPS = new Map(householdManifest.operations.map((o) => [o.id, o]));
    const calls = [];
    const runner = createFlowRunner({ ops: OPS, callSkill: async (opId, args) => { calls.push({ opId, args }); return opId === 'enrollDevice' ? { ok: true, deviceId: 'd', reloadRequired: true } : { outcome: 'no-offer' }; } });
    let inst = await runner.start(FLOW, {});
    expect(inst.awaiting?.step).toBe('ceremony');
    const form = OPS.get('enrollDevice').params.map((p) => p.name);
    expect(form).toContain(ENROL_PERSONAS_PARAM);
    inst = await runner.resume(FLOW, inst, { input: { mnemonic: 'x y z', [ENROL_PERSONAS_PARAM]: ['p-0123456789ab'] } });
    const enrol = calls.find((c) => c.opId === 'enrollDevice');
    expect(enrol?.args?.personas).toEqual(['p-0123456789ab']);
  });
});
