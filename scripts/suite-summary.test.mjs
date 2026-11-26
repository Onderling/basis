import { describe, it, expect } from 'vitest';
import { summarize } from './suite-summary.mjs';

const ROOT = '/repo/apps/basis';
const file = (name, status, tests = [], message = '') => ({ name: `${ROOT}/${name}`, status, message, assertionResults: tests });
const t = (fullName, status, msg = '') => ({ fullName, status, failureMessages: msg ? [msg] : [] });

describe('suite-summary', () => {
  it('a red run names every failing file, its failing tests and the first line of each failure', () => {
    const json = {
      numTotalTests: 5, numFailedTests: 2, numTotalTestSuites: 3, numFailedTestSuites: 2,
      testResults: [
        file('test/a.test.js', 'passed', [t('a works', 'passed')]),
        file('test/b.test.js', 'failed', [t('b one', 'failed', 'AssertionError: expected 1 to be 2\n    at x'), t('b two', 'passed')]),
        file('test/c.test.js', 'failed', [t('c one', 'failed', 'Error: boom')]),
      ],
    };
    const { text, failedFiles } = summarize(json, ROOT);
    expect(failedFiles).toEqual(['test/b.test.js', 'test/c.test.js']);
    expect(text).toMatch(/2 of 3 files failed \(2 of 5 tests\)/);
    expect(text).toMatch(/test\/b\.test\.js\n.*b one — AssertionError: expected 1 to be 2/);
    expect(text).not.toMatch(/at x/);
    expect(text).toMatch(/test\/c\.test\.js\n.*c one — Error: boom/);
  });

  it('a file that fails to load (no tests ran) still shows, with its own message', () => {
    const json = {
      numTotalTests: 0, numFailedTests: 0, numTotalTestSuites: 1, numFailedTestSuites: 1,
      testResults: [file('test/d.test.js', 'failed', [], 'Error: Cannot find module x\n stack')],
    };
    const { text, failedFiles } = summarize(json, ROOT);
    expect(failedFiles).toEqual(['test/d.test.js']);
    expect(text).toMatch(/test\/d\.test\.js\n.*did not load — Error: Cannot find module x/);
  });

  it('a green run says so in one line', () => {
    const json = { numTotalTests: 4, numFailedTests: 0, numTotalTestSuites: 2, numFailedTestSuites: 0, testResults: [] };
    const { text, failedFiles } = summarize(json, ROOT);
    expect(failedFiles).toEqual([]);
    expect(text).toBe('✓ 2 files, 4 tests green');
  });

  it('a file with many failing tests lists the first five and counts the rest', () => {
    const tests = Array.from({ length: 8 }, (_, i) => t(`e ${i}`, 'failed', 'Error: no'));
    const json = { numTotalTests: 8, numFailedTests: 8, numTotalTestSuites: 1, numFailedTestSuites: 1, testResults: [file('test/e.test.js', 'failed', tests)] };
    const { text } = summarize(json, ROOT);
    expect(text).toMatch(/e 4 — /);
    expect(text).not.toMatch(/e 5 — /);
    expect(text).toMatch(/and 3 more/);
  });
});
