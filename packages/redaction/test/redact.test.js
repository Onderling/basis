// Engine tests — the structured rule pass. Ported from feedback-pipeline's
// redact.test.js, now driving the GENERIC engine + the NL fixture config, to
// prove the extraction is behaviour-preserving.
import { describe, test, expect } from 'vitest';
import { redact, redactText } from '../src/index.js';
import { STRUCTURED_CONFIG as C, PLACEHOLDER } from './fixtures/nl-config.js';

const r = (t) => redact(t, C);
const rt = (t) => redactText(t, C);

test('email is redacted (and hits recorded)', () => {
  const { text, hits } = r('mail jan@reparatie.nl voor de afspraak');
  expect(text).toBe(`mail ${PLACEHOLDER.email} voor de afspraak`);
  expect(hits.map((h) => h.type)).toEqual(['email']);
});

test('url is redacted', () => {
  expect(rt('het formulier staat op https://forms.example/abc123 alsjeblieft'))
    .toBe(`het formulier staat op ${PLACEHOLDER.url} alsjeblieft`);
});

test('IBAN is redacted (with spaces)', () => {
  expect(rt('maak over naar IBAN NL12 RABO 0123 4567 89 voor vrijdag'))
    .toBe(`maak over naar IBAN ${PLACEHOLDER.iban} voor vrijdag`);
});

test('Dutch postcode is redacted', () => {
  expect(rt('zij woont op 3512 JK in het centrum'))
    .toBe(`zij woont op ${PLACEHOLDER.postcode} in het centrum`);
});

test('street + house number is redacted', () => {
  expect(rt('We wonen op Kerkstraat 12 in Utrecht'))
    .toBe(`We wonen op ${PLACEHOLDER.address} in Utrecht`);
});

test('NL phone numbers in several formats are redacted', () => {
  for (const phone of ['0612345678', '06-1234 5678', '030-1234567', '+31 6 12345678']) {
    const { text, hits } = r(`bel ${phone} maar`);
    expect(text, phone).toBe(`bel ${PLACEHOLDER.phone} maar`);
    expect(hits[0].type).toBe('phone');
  }
});

test('dates and money are NOT mistaken for phone numbers', () => {
  expect(rt('op 2026-06-02 kost het 20 euro')).toBe(`op ${PLACEHOLDER.date} kost het 20 euro`);
  expect(rt('hij is 12 jaar en woont hier 3 maanden')).toBe('hij is 12 jaar en woont hier 3 maanden');
});

test('a clean message is returned unchanged', () => {
  const msg = 'good morning everyone, hope you slept well';
  const { text, hits } = r(msg);
  expect(text).toBe(msg);
  expect(hits.length).toBe(0);
});

test('multiple identifiers in one message all get caught', () => {
  const { hits } = r('bel Jan op 0612345678 of mail jan@reparatie.nl');
  expect(hits.map((h) => h.type).sort()).toEqual(['email', 'phone']);
});

test('names are deliberately NOT touched by the structured pass', () => {
  expect(rt('bel Jan op 0612345678')).toMatch(/Jan/);
});

// ── FALSE POSITIVES (documented known limitations) ──────────────────
test('FALSE POSITIVE: a year + 2-letter abbreviation looks like a postcode', () => {
  expect(rt('in het jaar 2024 AD')).toBe(`in het jaar ${PLACEHOLDER.postcode}`);
  expect(rt('the battle of 1066 AD')).toBe(`the battle of ${PLACEHOLDER.postcode}`);
});

test('FALSE POSITIVE: an order/reference number shaped like an NL mobile', () => {
  expect(rt('bestelnummer 0612345678 is verzonden'))
    .toBe(`bestelnummer ${PLACEHOLDER.phone} is verzonden`);
});

test('FALSE POSITIVE: a product SKU shaped like an IBAN (format-only rule)', () => {
  // The structured IBAN rule is format-only (no checksum), so the SKU matches.
  expect(rt('artikel NL21ABCD1234567890 op voorraad'))
    .toBe(`artikel ${PLACEHOLDER.iban} op voorraad`);
});

test('FALSE POSITIVE: a highway "street+number" is redacted as address', () => {
  expect(rt('we reden over de Snelweg 12 vanochtend'))
    .toBe(`we reden over de ${PLACEHOLDER.address} vanochtend`);
});

// ── phone robustness ────────────────────────────────────────────────
test('phone with pair-spaced digits is still caught', () => {
  expect(rt('bel 06 12 34 56 78 maar')).toBe(`bel ${PLACEHOLDER.phone} maar`);
});

test('international phone numbers are caught', () => {
  expect(rt('call +1 415 555 0123')).toBe(`call ${PLACEHOLDER.phone}`);
});

test('FALSE NEGATIVE: city without street/number is not an address', () => {
  expect(rt('we wonen in Utrecht')).toBe('we wonen in Utrecht');
});

// ── BSN ─────────────────────────────────────────────────────────────
test('a numeric date (DOB) is redacted', () => {
  expect(rt('geboortedatum 12-03-1991 graag')).toBe(`geboortedatum ${PLACEHOLDER.date} graag`);
  expect(rt('op 2026-06-02 had ik een afspraak')).toBe(`op ${PLACEHOLDER.date} had ik een afspraak`);
});

test('a labelled BSN is redacted even if it fails the 11-proef (keeps "BSN")', () => {
  const out = rt('mijn BSN is 184729356 voor het dossier');
  expect(out).toMatch(/\[bsn\]/);
  expect(out).not.toMatch(/184729356/);
  expect(out).toMatch(/BSN is \[bsn\]/);
});

test('a labelled dossier/case number is redacted', () => {
  expect(rt('mijn dossiernummer is 84422190 graag')).toMatch(/\[dossiernummer\] graag/);
});

test('a valid BSN (passes 11-proef) is redacted, hit value recorded', () => {
  const { text, hits } = r('mijn BSN is 123456782 voor het dossier');
  expect(text).toBe(`mijn BSN is ${PLACEHOLDER.bsn} voor het dossier`);
  expect(hits.find((h) => h.type === 'bsn')?.value).toBe('123456782');
});

test('a 9-digit number that FAILS the checksum is left alone (FP guard)', () => {
  expect(rt('ordernummer 123456789 verzonden')).toBe('ordernummer 123456789 verzonden');
});

test('an 8-digit KvK number is not a BSN and is left alone', () => {
  expect(rt('eigen BV met KvK 12345678')).toBe('eigen BV met KvK 12345678');
});

// ── stress-test fixes ───────────────────────────────────────────────
test('obfuscated email is redacted', () => {
  expect(rt('mail me op jan dot devries at gmail dot com graag'))
    .toBe(`mail me op ${PLACEHOLDER.email} graag`);
});

test('international (+CC) phone numbers are redacted', () => {
  expect(rt('bel me op +49 171 2345678 als je wilt'))
    .toBe(`bel me op ${PLACEHOLDER.phone} als je wilt`);
});

test('a spaced/grouped valid BSN is redacted (normalize: strip-spaces)', () => {
  expect(rt('mijn nummer is 1111 11 110 voor de administratie'))
    .toBe(`mijn nummer is ${PLACEHOLDER.bsn} voor de administratie`);
});

test('LIMIT: a non-BSN 9-digit number that passes the checksum is a residual FP', () => {
  expect(rt('referentie 111111110')).toBe(`referentie ${PLACEHOLDER.bsn}`);
});

// ── engine semantics ────────────────────────────────────────────────
test('rule ordering: url/email consume digit runs before the phone pass', () => {
  // an email containing digits is not re-read as a phone
  const { hits } = r('mail 0612345678user@host.nl nu');
  expect(hits.map((h) => h.type)).toContain('email');
});

test('an unknown validator name throws a clear error', () => {
  expect(() => redact('x', { rules: [{ type: 't', pattern: /x/g, validate: 'nope' }] }))
    .toThrow(/unknown validator 'nope'/);
});

test('a RegExp pattern without the global flag is handled', () => {
  const { text } = redact('aXbXc', { rules: [{ type: 'x', pattern: /X/, replacement: '-' }] });
  expect(text).toBe('a-b-c');
});

test('replacement falls back to placeholders[type] when omitted', () => {
  const { text } = redact('go https://a.b now', C);
  expect(text).toContain(PLACEHOLDER.url);
});
