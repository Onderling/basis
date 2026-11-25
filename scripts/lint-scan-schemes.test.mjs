import { describe, it, expect } from 'vitest';
import { schemeProblems, ROUTER, check } from './lint-scan-schemes.mjs';

const TABLE = { 'onderling-contact://': 'contact', 'onderling-koppel:': 'botlink' };

describe('lint-scan-schemes', () => {
  it('a scheme constant the router does not know is red; a known one is green', () => {
    expect(schemeProblems({ 'a.js': "export const NEW_SCHEME = 'onderling-new://';" }, TABLE)).toHaveLength(1);
    expect(schemeProblems({ 'a.js': "export const CONTACT_SCHEME = 'onderling-contact://';" }, TABLE)).toEqual([]);
    expect(schemeProblems({ 'a.js': "export const LINK_OFFER_SCHEME = 'onderling-koppel:';" }, TABLE)).toEqual([]);
  });
  it('an onderling-…:// literal the router does not know is red', () => {
    expect(schemeProblems({ 'a.js': "if (t.startsWith('onderling-other://')) go();" }, TABLE)).toHaveLength(1);
  });
  it('a const named SCHEME that is not a scheme (a pattern, a vault prefix) is not read as one', () => {
    expect(schemeProblems({ 'a.js': "const SETTINGS_SCHEME = 'mem';\nconst X = 'onderling-screen:';" }, TABLE)).toEqual([]);
  });
  it('classifying a code outside the router is red; inside it, green', () => {
    expect(schemeProblems({ 'b.js': 'const r = classifyQrPayload(text, LIST);' }, TABLE)).toHaveLength(1);
    expect(schemeProblems({ [ROUTER]: 'const r = classifyQrPayload(text, LIST);' }, TABLE)).toEqual([]);
  });
  it('the repo itself is clean', async () => {
    expect(await check()).toEqual([]);
  });
});
