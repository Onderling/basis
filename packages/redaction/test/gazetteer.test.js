// Gazetteer tests — the name pass. Ported from feedback-pipeline's names.test.js,
// now driving the GENERIC engine + the NL fixture gazetteer.
import { describe, test, expect } from 'vitest';
import { redactGazetteer, redact } from '../src/index.js';
import { GAZETTEER as G, NAMES_CONFIG } from './fixtures/nl-config.js';

const N = '[naam]';
const rn = (t) => redactGazetteer(t, G);

// ── true positives ──────────────────────────────────────────────────
test('catches known first names in name context', () => {
  expect(rn('bel Jan even terug').text).toBe(`bel ${N} even terug`);
  expect(rn('vraag Lisa en Peter').text).toBe(`vraag ${N} en ${N}`);
  expect(rn('Sarah and John are coming').text).toBe(`${N} and ${N} are coming`);
});

test('lowercase homographs are left alone (capital required)', () => {
  expect(rn('ik wil de datum mark-eren').text).toBe('ik wil de datum mark-eren');
  expect(rn('a single rose in lowercase').text).toBe('a single rose in lowercase');
});

// ── FALSE POSITIVES (known limitation) ──────────────────────────────
test('FALSE POSITIVE: capitalised common words that are also names', () => {
  expect(rn('Mark de datum vast in je agenda').text).toBe(`${N} de datum vast in je agenda`);
  expect(rn('Will you join us tonight?').text).toBe(`${N} you join us tonight?`);
  expect(rn('May is the nicest month').text).toBe(`${N} is the nicest month`);
  expect(rn('Er bloeit een Roos in de tuin').text).toBe(`Er bloeit een ${N} in de tuin`);
  expect(rn('Storm verwacht voor vannacht').text).toBe(`${N} verwacht voor vannacht`);
  expect(rn('We did this with Grace and Hope').text).toBe(`We did this with ${N} and ${N}`);
});

test('FALSE POSITIVE: any sentence-initial gazetteer word', () => {
  expect(rn('Floor is nat, pas op').text).toBe(`${N} is nat, pas op`);
  expect(rn('Beer is op, nieuwe halen').text).toBe(`${N} is op, nieuwe halen`);
});

// ── FALSE NEGATIVES (known limitation) ──────────────────────────────
test('FALSE NEGATIVE: foreign / rare first names are missed', () => {
  for (const name of ['Xanthe', 'Tariq', 'Mehmet', 'Aaliyah', 'Bjørn']) {
    const { text, hits } = rn(`bel ${name} even`);
    expect(text, name).toBe(`bel ${name} even`);
    expect(hits.length).toBe(0);
  }
});

// ── title passes ────────────────────────────────────────────────────
test('honorific + name redacts even an UNKNOWN surname', () => {
  expect(rn('meneer Jansen klaagde erover').text).toBe('meneer [naam] klaagde erover');
  expect(rn('Pas toen dr. Vermeer langs kwam').text).toBe('Pas toen dr. [naam] langs kwam');
  expect(rn('mevrouw Linda Brouwer belde').text).toBe('mevrouw [naam] belde');
});

test('honorific pass keeps the FOLLOWING ordinary word (no over-redaction)', () => {
  expect(rn('meneer Jansen klaagde erover').text).toBe('meneer [naam] klaagde erover');
  expect(rn('ik wil de heer spreken').text).toBe('ik wil de heer spreken');
});

test('FALSE NEGATIVE: a bare surname with no title/known first name is missed', () => {
  expect(rn('Jansen klaagde erover').text).toBe('Jansen klaagde erover');
});

test('honorific handles a particle surname (Mr. de Vries)', () => {
  expect(rn('a Mr. de Vries replied once').text).toBe('a Mr. [naam] replied once');
  expect(rn('ene meneer De Wit van Team Mobiliteit').text).toBe('ene meneer [naam] van Team Mobiliteit');
});

test('relational titles (neighbour/family) redact an ordinary name', () => {
  expect(rn('mijn buurman Henk de Vries op nummer 14').text).toBe('mijn buurman [naam] op nummer 14');
  expect(rn('Mijn buurvrouw Annelies met haar mantelzorg').text).toBe('Mijn buurvrouw [naam] met haar mantelzorg');
  expect(rn('sinds mijn vrouw Annie is overleden').text).toBe('sinds mijn vrouw [naam] is overleden');
  expect(rn('my neighbour Anja from the committee').text).toBe('my neighbour [naam] from the committee');
  expect(rn('als vrouw voel ik me niet veilig').text).toBe('als vrouw voel ik me niet veilig');
});

test('KEEP a named official (policy: powerful individuals are surfaced)', () => {
  expect(rn('Wethouder Karim El Idrissi drukt het door').text)
    .toBe('Wethouder Karim El Idrissi drukt het door');
});

test('FALSE NEGATIVE: lowercase / misspelled names are missed', () => {
  expect(rn('bel jan even').text).toBe('bel jan even');
  expect(rn('bel Jannn even').text).toBe('bel Jannn even');
});

// ── full-name removal ───────────────────────────────────────────────
test('a known first name + surname removes the WHOLE name', () => {
  expect(rn('bel Mark Delaney terug').text).toBe(`bel ${N} terug`);
  expect(rn('vraag Lisa Jansen even').text).toBe(`vraag ${N} even`);
});

test('a known first name alone still works (no surname required)', () => {
  expect(rn('bel Mark even').text).toBe(`bel ${N} even`);
});

// ── placeholders are not disturbed ──────────────────────────────────
test('does not touch existing [placeholder] tokens', () => {
  const s = 'bel de monteur op [telefoonnummer] of mail [e-mailadres]';
  expect(rn(s).text).toBe(s);
});

// ── job-title pass ──────────────────────────────────────────────────
test('job-title + name → name redacted (private roles), incl. particle surname', () => {
  expect(rn('van dokter Smeets de medicatie').text).toMatch(/dokter \[naam\]/);
  expect(rn('Afdelingshoofd Van Dijk vervalst facturen').text).toMatch(/Afdelingshoofd \[naam\]/);
  expect(rn('Manager Karim vraagt gunsten').text).toMatch(/Manager \[naam\]/);
});

test('job-title pass does NOT redact public officials or departments', () => {
  expect(rn('Wethouder Karim El Idrissi drukt het door').text)
    .toBe('Wethouder Karim El Idrissi drukt het door');
  expect(rn('De werkdruk op afdeling Logistiek is hoog').text)
    .toBe('De werkdruk op afdeling Logistiek is hoog');
});

// ── via the full engine (rules:[] + gazetteer) ──────────────────────
test('redact() runs the gazetteer when config carries one', () => {
  const { text, hits } = redact('bel Jan even', NAMES_CONFIG);
  expect(text).toBe('bel [naam] even');
  expect(hits).toEqual([{ type: 'name', value: 'Jan' }]);
});

// ── config-driven (not locale-baked) ────────────────────────────────
test('a DIFFERENT gazetteer (no NL content) works — engine is locale-agnostic', () => {
  const g = { names: ['alice', 'bob'], placeholder: '<X>', titlePatterns: [] };
  expect(redactGazetteer('call Alice and Bob', g).text).toBe('call <X> and <X>');
  expect(redactGazetteer('call Jan', g).text).toBe('call Jan'); // Jan not in THIS list
});
