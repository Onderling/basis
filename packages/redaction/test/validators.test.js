// Unit tests for the named-validator registry.
import { describe, test, expect } from 'vitest';
import { VALIDATORS, bsn11proef, nlPhone, iban, luhn } from '../src/index.js';

describe('bsn-11proef', () => {
  test('accepts a valid 9-digit BSN (passes 11-proef)', () => {
    expect(bsn11proef('123456782')).toBe(true);
    expect(bsn11proef('111111110')).toBe(true);
  });
  test('rejects a 9-digit number that fails the checksum', () => {
    expect(bsn11proef('123456789')).toBe(false);
    expect(bsn11proef('184729356')).toBe(false);
  });
  test('rejects non-9-digit / non-numeric input', () => {
    expect(bsn11proef('12345678')).toBe(false);   // 8 digits
    expect(bsn11proef('1234567890')).toBe(false);  // 10 digits
    expect(bsn11proef('1111 11 110')).toBe(false); // spaces (caller must normalize)
    expect(bsn11proef('abcdefghi')).toBe(false);
  });
  test('is reachable via the registry under its name', () => {
    expect(VALIDATORS['bsn-11proef']).toBe(bsn11proef);
  });
});

describe('nl-phone', () => {
  test('accepts NL mobile/landline in several formats', () => {
    for (const p of ['0612345678', '06-1234 5678', '030-1234567', '+31 6 12345678', '06 12 34 56 78']) {
      expect(nlPhone(p), p).toBe(true);
    }
  });
  test('accepts 31-prefixed and typo-tolerant +31 0 forms', () => {
    expect(nlPhone('31612345678')).toBe(true);
    expect(nlPhone('+310612345678')).toBe(true);
  });
  test('rejects a 9-digit BSN-shaped number and short runs', () => {
    expect(nlPhone('123456782')).toBe(false);  // 9 digits, not a phone
    expect(nlPhone('12345')).toBe(false);
  });
  test('registry name', () => {
    expect(VALIDATORS['nl-phone']).toBe(nlPhone);
  });
});

describe('iban', () => {
  test('accepts a checksum-valid IBAN (spaces tolerated)', () => {
    expect(iban('NL91ABNA0417164300')).toBe(true);
    expect(iban('NL91 ABNA 0417 1643 00')).toBe(true);
    expect(iban('DE89370400440532013000')).toBe(true);
  });
  test('rejects a wrong check digit and a malformed string', () => {
    expect(iban('NL92ABNA0417164300')).toBe(false);
    expect(iban('NL21ABCD1234567890')).toBe(false); // the SKU false-positive: fails the real checksum
    expect(iban('not an iban')).toBe(false);
  });
  test('registry name', () => {
    expect(VALIDATORS.iban).toBe(iban);
  });
});

describe('luhn', () => {
  test('accepts a Luhn-valid number', () => {
    expect(luhn('4539578763621486')).toBe(true); // valid test PAN
    expect(luhn('79927398713')).toBe(true);
  });
  test('rejects a Luhn-invalid number', () => {
    expect(luhn('4539578763621487')).toBe(false);
    expect(luhn('79927398710')).toBe(false);
  });
  test('strips separators before validating', () => {
    expect(luhn('4539 5787 6362 1486')).toBe(true);
  });
  test('registry name', () => {
    expect(VALIDATORS.luhn).toBe(luhn);
  });
});
