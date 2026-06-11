// Category-floors closeout (2026-06-11): sensitive-content quarantine extension
// (health/financial/pay-inequality/child-welfare) + the Dutch licence-plate PII floor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectSensitiveContent } from '../src/signals.js';
import { redact } from '../src/redact.js';

test('sensitive-content: single-user health/financial/pay/child-welfare grievances quarantine', () => {
  for (const t of [
    'ik heb een zware burn-out en kan niet werken',
    'ik ben arbeidsongeschikt verklaard',
    'ik zit diep in de schulden en kan niet rondkomen',
    'er ligt loonbeslag op mijn salaris',
    'ik word onderbetaald voor hetzelfde werk dan mijn collega',
    'de loonkloof tussen mannen en vrouwen is hier groot',
    'I am being paid less than my male colleagues',
    'zorgen om de veiligheid van het kind, jeugdzorg is betrokken',
    'this looks like child neglect',
  ]) {
    assert.equal(detectSensitiveContent(t).isSensitive, true, `should be sensitive: ${t}`);
  }
});

test('sensitive-content: ordinary feedback is NOT flagged', () => {
  for (const t of ['de koffie is op', 'de wachttijden zijn te lang', 'kun je de lamp repareren?']) {
    assert.equal(detectSensitiveContent(t).isSensitive, false, `should NOT be sensitive: ${t}`);
  }
});

test('redact: Dutch licence plate (kenteken) → [kenteken] across sidecodes', () => {
  for (const [t, plate] of [
    ['mijn kenteken is AB-12-34', 'AB-12-34'],
    ['de auto 99-XYZ-1 reed weg', '99-XYZ-1'],
    ['gezien: 12-AB-34', '12-AB-34'],
    ['nummerbord 1-ABC-23', '1-ABC-23'],
  ]) {
    const out = redact(t).text;
    assert.ok(out.includes('[kenteken]'), `expected [kenteken] for ${t} → ${out}`);
    assert.ok(!out.includes(plate), `plate ${plate} should be gone in ${out}`);
  }
});

test('redact: a real date is still [datum], not mistaken for a plate', () => {
  const out = redact('afspraak op 12-05-1980').text;
  assert.ok(out.includes('[datum]'));
  assert.ok(!out.includes('[kenteken]'));
});
