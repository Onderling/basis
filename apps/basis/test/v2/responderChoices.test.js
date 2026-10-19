/**
 * THE POSTER'S ACCEPT LIVES ON THE REQUEST. Who answered is recorded on the poster's copy (`source.responders`, from the
 * answer's verified sender); the shells offer one Accept per recorded responder, labelled from the roster — on the
 * poster's own open request only. One projection, both shells.
 */
import { describe, it, expect } from 'vitest';
import { responderChoices } from '../../src/v2/circlePinboardScope.js';

const members = [{ webid: 'pk-me', handle: 'anna' }, { webid: 'pk-mel', handle: 'mel' }];
const req = (over = {}) => ({ id: 'r1', type: 'request', addedBy: 'pk-me', source: { responders: ['pk-mel'] }, ...over });

describe('responderChoices', () => {
  it('my open request: one choice per recorded responder, named from the roster', () => {
    const c = responderChoices(req(), { viewerId: 'pk-me', members });
    expect(c).toHaveLength(1);
    expect(c[0].webid).toBe('pk-mel');
    expect(typeof c[0].label).toBe('string');
    expect(c[0].label.length).toBeGreaterThan(0);
  });
  it("someone else's request, a closed one, or one nobody answered: no choices", () => {
    expect(responderChoices(req({ addedBy: 'pk-mel' }), { viewerId: 'pk-me', members })).toEqual([]);
    expect(responderChoices(req({ completedAt: 5 }), { viewerId: 'pk-me', members })).toEqual([]);
    expect(responderChoices(req({ source: {} }), { viewerId: 'pk-me', members })).toEqual([]);
    expect(responderChoices(req(), { viewerId: null, members })).toEqual([]);
  });
});
