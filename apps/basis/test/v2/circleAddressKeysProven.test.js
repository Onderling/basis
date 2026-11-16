// A roster row's per-circle address is bound to the person's key for sealing whether or not the person proved it (a
// legacy row carries none); the binding says WHICH, so the "is this my contact's other device" question asks only the
// proven ones.
import { describe, it, expect } from 'vitest';
import { bindCircleAddressKeys } from '../../src/v2/circleAddressKeys.js';

describe('bindCircleAddressKeys says whether each address was proven', () => {
  it('a primary with its proof is proven; a primary without is not; a fold-verified extra is', () => {
    const calls = [];
    const registerPeerAddress = (address, pubKey, o) => { calls.push({ address, pubKey, proven: o?.proven === true }); };
    bindCircleAddressKeys({
      registerPeerAddress,
      members: [
        { pubKey: 'bob', circleAddress: 'bob-c', circleAddressProof: 'sig', circleSigningKey: 'bob-c-key', circleAddresses: ['bob-c', 'bob-c2'] },
        { pubKey: 'old', circleAddress: 'old-c' },
      ],
    });
    expect(calls).toEqual([
      { address: 'bob-c', pubKey: 'bob', proven: true },
      { address: 'bob-c2', pubKey: 'bob', proven: true },
      { address: 'old-c', pubKey: 'old', proven: false },
    ]);
  });
});
