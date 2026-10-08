// The claim line a companion prints, as the app reads it; the line a device ceremony ends on, as both shells paint it;
// and the person's own list of the nodes they own.
import { describe, it, expect } from 'vitest';
import { parseCompanionClaim } from '../../src/v2/companionClaim.js';
import { ceremonyOutcomeText } from '../../src/v2/ceremonyOutcome.js';
import { ownedNodesOf, setOwnedNode } from '@onderling/agent-registry';
import nl from '../../src/locales/circle.nl.json' with { type: 'json' };

const ADDR = 'Abc_def-0123456789xyzABCDEF';
const t = (key) => key.split('.').slice(1).reduce((o, k) => o?.[k], nl) ?? key;

describe('the claim line', () => {
  it('reads the code and the node, with or without the label, any case, the dash optional', () => {
    expect(parseCompanionClaim(`Claim: ABCD-EFGH@${ADDR}`)).toEqual({ code: 'ABCD-EFGH', node: ADDR });
    expect(parseCompanionClaim(`  abcdefgh @ ${ADDR} `)).toEqual({ code: 'ABCD-EFGH', node: ADDR });
    expect(parseCompanionClaim('ABCD-EFGH')).toBeNull();
    expect(parseCompanionClaim(`ABCD-EFGH@short`)).toBeNull();
    expect(parseCompanionClaim(null)).toBeNull();
  });
});

describe('the line a device ceremony ends on', () => {
  it('names a clock that is off and a code that ran out; falls back to the op\'s error, then "failed"', () => {
    expect(ceremonyOutcomeText({ keyPrefix: 'companionClaim', outcome: 'ok', t })).toBe(nl.companionClaim.done);
    expect(ceremonyOutcomeText({ keyPrefix: 'companionClaim', outcome: 'stale', t })).toBe(nl.companionClaim.outcome_stale);
    expect(ceremonyOutcomeText({ keyPrefix: 'companionClaim', outcome: 'invalid-code', t })).toBe(nl.companionClaim.outcome_invalid_code);
    expect(ceremonyOutcomeText({ keyPrefix: 'revoke', outcome: 'wrong-phrase', t })).toBe(nl.enroll.invalid_phrase);
    expect(ceremonyOutcomeText({ keyPrefix: 'revoke', outcome: 'error', out: { error: 'boom' }, t })).toBe('boom');
    expect(ceremonyOutcomeText({ keyPrefix: 'revoke', outcome: 'error', t })).toBe(nl.revoke.failed);
  });
});

describe('the nodes a person owns', () => {
  it('upserts by address and keeps the others', () => {
    let p = setOwnedNode({}, { address: 'n1', claimedAt: '2026-10-08T10:00:00Z' });
    p = setOwnedNode(p, { address: 'n2', claimedAt: '2026-10-08T11:00:00Z', label: 'thuis' });
    expect(Object.keys(ownedNodesOf({ properties: p }))).toEqual(['n1', 'n2']);
    expect(ownedNodesOf({ properties: p }).n2.label).toBe('thuis');
    expect(() => setOwnedNode(p, { address: 'n3' })).toThrow();
  });
});
