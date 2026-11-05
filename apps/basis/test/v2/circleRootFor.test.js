/**
 * Where a circle's pod data lives, for every member. A CENTRAL-POD (shared) circle lives at the address its founder
 * gave it — the same address for the founder and for every joiner, each reading and writing it with their own session
 * under the grants the circle writes per member. It used to be each member's OWN pod at circles/<id>: the founder wrote
 * there, every joiner read its own pod, and a central-pod circle shared nothing end to end. A POD-ONLY (personal)
 * circle keeps each member's own pod.
 */
import { describe, it, expect } from 'vitest';
import { circleRootFor } from '../../src/v2/circleRealPod.js';

const own = 'https://bob.example/circles/c1';

describe('a circle pod root, for every member', () => {
  it('central pod: the address the circle was given — for the founder and a joiner alike, never their own pod', () => {
    expect(circleRootFor({ pod: 'shared', recordedPodUri: 'https://ann.example/circles/huis/', ownCircleRoot: own })).toBe('https://ann.example/circles/huis');
    expect(circleRootFor({ pod: 'hybrid', recordedPodUri: 'https://ann.example/circles/huis', ownCircleRoot: own })).toBe('https://ann.example/circles/huis');
  });
  it('central pod with no recorded address: no root at all — never quietly the member\'s own pod', () => {
    expect(circleRootFor({ pod: 'shared', recordedPodUri: null, ownCircleRoot: own })).toBe(null);
    expect(circleRootFor({ pod: 'shared', recordedPodUri: 'not a url', ownCircleRoot: own })).toBe(null);
  });
  it('pod-only: each member\'s own pod', () => {
    expect(circleRootFor({ pod: 'personal', recordedPodUri: 'https://ann.example/x', ownCircleRoot: own })).toBe(own);
  });
});

describe('ownsCircleRoot', () => {
  it('true only when the circle root sits on this device\'s pod', async () => {
    const { ownsCircleRoot } = await import('../../src/v2/circleRealPod.js');
    expect(ownsCircleRoot({ podRoot: 'https://ann.pod/', circleRootUri: 'https://ann.pod/circles/c1' })).toBe(true);
    expect(ownsCircleRoot({ podRoot: 'https://bo.pod/', circleRootUri: 'https://ann.pod/circles/c1' })).toBe(false);
    expect(ownsCircleRoot({ podRoot: 'https://ann.pod/x', circleRootUri: 'https://ann.pod/xy/c1' })).toBe(false);
    expect(ownsCircleRoot({ podRoot: null, circleRootUri: 'https://ann.pod/c1' })).toBe(false);
  });
});
