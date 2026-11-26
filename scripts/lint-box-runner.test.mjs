import { describe, it, expect } from 'vitest';
import { bashSyntaxMessage, testFailureMessage } from './lint-box-runner.mjs';

describe('lint-box-runner', () => {
  it('a script that does not parse is named as file:line with what to do instead', () => {
    const msg = bashSyntaxMessage('deploy/box/lib.sh', "deploy/box/lib.sh: line 12: syntax error near unexpected token `fi'\n");
    expect(msg).toMatch(/deploy\/box\/lib\.sh:12\b/);
    expect(msg).toMatch(/syntax error/);
    expect(msg).toMatch(/Fix: /);
  });
  it('a failing updater test is named as file:line (relative to the repo) with how to rerun it', () => {
    const tap = [
      'TAP version 13',
      'not ok 1 - rolls back on a failed health check',
      '  ---',
      "  location: '/repo/deploy/box/test/update.test.mjs:41:3'",
      "  error: '1 == 2'",
      "  name: 'AssertionError'",
      'ok 2 - holds',
    ].join('\n');
    const msg = testFailureMessage(tap, '/repo');
    expect(msg).toMatch(/not ok 1 - rolls back/);
    expect(msg).toMatch(/deploy\/box\/test\/update\.test\.mjs:41\b/);
    expect(msg).not.toMatch(/\/repo\//);
    expect(msg).toMatch(/Fix: .*node --test deploy\/box\/test\/update\.test\.mjs/);
  });
});
