/**
 * A WRITE INTO ANOTHER CIRCLE ASKS THAT CIRCLE'S SWITCHES (the door asks only the circle an op names), and answers as
 * that circle's receivers will: they judge only where a settings change was kept (`contentJudge.js`).
 */
import { describe, it, expect } from 'vitest';
import { writeIntoRefusal, gateRefusalKey } from '../../src/v2/circleActGate.js';
import { allManifests } from '../../src/v2/manifestSources.js';
import { POLICY_UPDATE_KIND } from '../../src/v2/policyUpdateLane.js';

const ADD_OFF = { capabilities: { 'tasks add task': { enabled: false } } };
const inputsWith = (policy) => async () => ({ policy });
const keptOf = (policy) => [{ kind: POLICY_UPDATE_KIND, author: 'admin', hash: 'p1', payload: { policy, version: 1, contentUpTo: { items: [], chat: [] } } }];

describe('writeIntoRefusal', () => {
  it('a row of a type whose add the target circle switched off is refused, in the door\'s words', async () => {
    const r = await writeIntoRefusal({ circleId: 'target', type: 'task', manifests: allManifests(), inputs: inputsWith(ADD_OFF), kept: keptOf(ADD_OFF) });
    expect(r).toBeTruthy();
    expect(gateRefusalKey(r.code)).toMatch(/^circle\.gate\./);
  });
  it('allowed when the target circle has it on; no reader or the own place: not this gate\'s decision', async () => {
    expect(await writeIntoRefusal({ circleId: 'target', type: 'task', manifests: allManifests(), inputs: inputsWith({}), kept: keptOf({}) })).toBeNull();
    expect(await writeIntoRefusal({ circleId: 'target', type: 'task', manifests: allManifests(), kept: keptOf(ADD_OFF) })).toBeNull();
  });
  it('as the receivers: no kept settings change (or not known yet) is never refused, whatever the first settings say', async () => {
    const calendarOffByDefault = inputsWith({});
    expect(await writeIntoRefusal({ circleId: 'pair', type: 'calendar-event', manifests: allManifests(), inputs: calendarOffByDefault, kept: [] })).toBeNull();
    expect(await writeIntoRefusal({ circleId: 'pair', type: 'calendar-event', manifests: allManifests(), inputs: calendarOffByDefault, kept: undefined })).toBeNull();
    // the same first settings with a kept change: the calendar is off there, and refused
    expect(await writeIntoRefusal({ circleId: 'pair', type: 'calendar-event', manifests: allManifests(), inputs: calendarOffByDefault, kept: keptOf({}) })).toBeTruthy();
  });
});
