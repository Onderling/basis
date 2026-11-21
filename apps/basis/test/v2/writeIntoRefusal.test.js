/**
 * A WRITE INTO ANOTHER CIRCLE ASKS THAT CIRCLE'S SWITCHES (the door asks only the circle an op names).
 */
import { describe, it, expect } from 'vitest';
import { writeIntoRefusal, gateRefusalKey } from '../../src/v2/circleActGate.js';
import { allManifests } from '../../src/v2/manifestSources.js';

const ADD_OFF = { capabilities: { 'tasks add task': { enabled: false } } };
const inputsWith = (policy) => async () => ({ policy });

describe('writeIntoRefusal', () => {
  it('a row of a type whose add the target circle has off is refused, in the door\'s words', async () => {
    const r = await writeIntoRefusal({ circleId: 'target', type: 'task', manifests: allManifests(), inputs: inputsWith(ADD_OFF) });
    expect(r).toBeTruthy();
    expect(gateRefusalKey(r.code)).toMatch(/^circle\.gate\./);
  });
  it('allowed when the target circle has it on; no reader or the own place: not this gate\'s decision', async () => {
    expect(await writeIntoRefusal({ circleId: 'target', type: 'task', manifests: allManifests(), inputs: inputsWith({}) })).toBeNull();
    expect(await writeIntoRefusal({ circleId: 'target', type: 'task', manifests: allManifests() })).toBeNull();
  });
});
