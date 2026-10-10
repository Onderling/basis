/**
 * The local/foreign line follows the circle's self. The host's own calls about a persona's circle arrive AS the
 * persona (core `invoke(…, { actAs })`), so the cores' "is this my own call?" must compare against the persona there —
 * or the device's own call in its persona's circle reads foreign.
 */
import { describe, it, expect } from 'vitest';
import { buildStoopScope } from '../src/skills/index.js';
import { rosterCallerIsForeign } from '../src/lib/rosterAccessGate.js';

const LOCAL = 'default-webid';
const PERSONA = 'persona-b-webid';
const selfWebidFor = (cid) => (cid === 'circle-b' ? PERSONA : LOCAL);

describe('localActorIn', () => {
  it('the persona in its circle, the default elsewhere; no host function → the default everywhere', () => {
    const scope = buildStoopScope({ localActor: LOCAL, selfWebidFor });
    expect(scope.localActorIn('circle-b')).toBe(PERSONA);
    expect(scope.localActorIn('circle-d')).toBe(LOCAL);
    expect(scope.localActorIn(null)).toBe(LOCAL);
    expect(buildStoopScope({ localActor: LOCAL }).localActorIn('circle-b')).toBe(LOCAL);
  });
  it('the persona\'s own call is LOCAL in its circle; a stranger stays foreign', () => {
    const scope = buildStoopScope({ localActor: LOCAL, selfWebidFor });
    expect(rosterCallerIsForeign(PERSONA, scope.localActorIn('circle-b'))).toBe(false);
    expect(rosterCallerIsForeign('stranger', scope.localActorIn('circle-b'))).toBe(true);
    // the line NOT moved: the persona's own call would read foreign
    expect(rosterCallerIsForeign(PERSONA, LOCAL)).toBe(true);
  });
});
