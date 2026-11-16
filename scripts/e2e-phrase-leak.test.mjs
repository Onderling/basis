/**
 * The custody journey's leak check: does an add-a-device offer carry any word of the recovery phrase? Whole words
 * only, in the DECODED payload and in whatever travels outside the base64 part. A base64 run that happens to spell a
 * phrase word ('bLaSt') is not a leak; a word in the decoded body or appended in the clear is.
 */
import { describe, it, expect } from 'vitest';
import { phraseWordsInOffer } from '../apps/e2e-journeys/phraseLeak.mjs';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const WORDS = ['blast', 'enroll', 'orange', 'abandon'];

describe('phraseWordsInOffer', () => {
  it('a payload whose base64 happens to contain a phrase word passes', () => {
    // base64 of these bytes contains the run 'bLaSt' (case-folded, the old substring check called it a leak)
    const raw = `onderling-enroll://xxbLaSt${b64('{"v":1,"c":["k1"]}')}`;
    expect(raw.toLowerCase()).toContain('blast');
    expect(phraseWordsInOffer(raw, WORDS)).toEqual([]);
  });
  it('the fixed scheme is not the payload: "enroll" in onderling-enroll:// is no leak', () => {
    expect(phraseWordsInOffer(`onderling-enroll://${b64('{"v":1}')}`, WORDS)).toEqual([]);
  });
  it('a word in the decoded body is a leak', () => {
    expect(phraseWordsInOffer(`onderling-enroll://${b64('{"hint":"orange tree"}')}`, WORDS)).toEqual(['orange']);
  });
  it('a word appended in the clear after the payload is a leak', () => {
    expect(phraseWordsInOffer(`onderling-enroll://${b64('{"v":1}')}?debug=abandon`, WORDS)).toEqual(['abandon']);
  });
  it('whole words only: "oranges" in the body is not "orange"', () => {
    expect(phraseWordsInOffer(`onderling-enroll://${b64('{"note":"oranges"}')}`, WORDS)).toEqual([]);
  });
});
