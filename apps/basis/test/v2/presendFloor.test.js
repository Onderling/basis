/**
 * The pre-send floor — a contact that declares `redact: 'pre-send'` gets the participant's text
 * redacted ON THIS DEVICE before anything leaves it. The floor is a property of the CONTACT (its
 * card declares it), never of one bot's code: basis runs @onderling/redaction with the platform
 * default ruleset, or with the ruleset the card ships as data.
 */
import { describe, it, expect } from 'vitest';
import { presendFloorFor, applyPresendFloor, PRESEND_DEFAULT_CONFIG } from '../../src/v2/presendFloor.js';

describe('presendFloorFor — what a contact record declares', () => {
  it('is null for a contact that declares nothing (a person, a bot without the flag)', () => {
    expect(presendFloorFor(null)).toBeNull();
    expect(presendFloorFor({ pubKey: 'x' })).toBeNull();
    expect(presendFloorFor({ pubKey: 'x', redact: 'post-receipt' })).toBeNull();
  });
  it("'pre-send' as a bare string → the platform default ruleset", () => {
    const cfg = presendFloorFor({ pubKey: 'x', redact: 'pre-send' });
    expect(cfg).toBe(PRESEND_DEFAULT_CONFIG);
  });
  it('an object with mode pre-send and its own rules → the declared rules (data from the card)', () => {
    const cfg = presendFloorFor({ redact: { mode: 'pre-send', rules: [{ type: 'code', pattern: 'X-\\d+' }], placeholders: { code: '[code]' } } });
    expect(cfg.rules).toHaveLength(1);
    expect(applyPresendFloor('ticket X-42 please', cfg).text).toBe('ticket [code] please');
  });
});

describe('applyPresendFloor — the default ruleset', () => {
  it('redacts a BSN (11-proef), an IBAN, a Dutch phone number and an e-mail address', () => {
    const r = applyPresendFloor('bel 06 12345678, bsn 123456782, NL91ABNA0417164300, mail jan@example.org', PRESEND_DEFAULT_CONFIG);
    expect(r.text).not.toMatch(/123456782|0417164300|jan@example\.org|12345678/);
    expect(r.hits.map((h) => h.type).sort()).toEqual(['bsn', 'email', 'iban', 'phone']);
  });
  it('leaves an ordinary sentence alone and reports no hits', () => {
    const r = applyPresendFloor('de wachtlijst is te lang', PRESEND_DEFAULT_CONFIG);
    expect(r).toEqual({ text: 'de wachtlijst is te lang', hits: [] });
  });
  it('keeps a nine-digit number that fails the 11-proef (not a BSN)', () => {
    expect(applyPresendFloor('order 123456789', PRESEND_DEFAULT_CONFIG).text).toBe('order 123456789');
  });
});
