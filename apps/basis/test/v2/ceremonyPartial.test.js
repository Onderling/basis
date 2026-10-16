/**
 * A ceremony that did what it could and says what is left — a revoke from a device without the general persona — ends
 * as DONE with its own line, never as a failure with a retry (retrying would do the same part again and nothing more).
 */
import { describe, it, expect } from 'vitest';
import { ceremonyOutcomeText, ceremonyFinished } from '../../src/v2/ceremonyOutcome.js';
import nl from '../../src/locales/circle.nl.json' with { type: 'json' };

const t = (key) => key.split('.').slice(1).reduce((o, k) => o?.[k], nl)?.text ?? key.split('.').slice(1).reduce((o, k) => o?.[k], nl) ?? key;

describe('a partial ceremony', () => {
  it('is finished, like ok — and a failure is not', () => {
    expect(ceremonyFinished('ok')).toBe(true);
    expect(ceremonyFinished('partial')).toBe(true);
    expect(ceremonyFinished('wrong-phrase')).toBe(false);
    expect(ceremonyFinished(null)).toBe(false);
  });
  it('says what is left, in its own words', () => {
    const line = ceremonyOutcomeText({ keyPrefix: 'revoke', outcome: 'partial', t });
    expect(line).toMatch(/algemene persona/);
    expect(line).not.toBe('circle.revoke.outcome_partial');
  });
});
