import { describe, it, expect } from 'vitest';
import { cookieUsesIn, isShipped, judge, COOKIE_EXCEPTION } from './lint-no-cookies.mjs';

const EXC = Object.keys(COOKIE_EXCEPTION)[0];
const live = "res.setHeader('Set-Cookie', `onderling-page=${t}; HttpOnly`);";

describe('lint-no-cookies', () => {
  it('is red on each kind of cookie use, with the line and what to use instead', () => {
    const f = 'apps/basis/web/v2/x.js';
    const uses = [
      'document.cookie = "a=1";',
      'await cookieStore.set("a", "1");',
      "res.setHeader('Set-Cookie', 'a=1');",
      'const c = req.headers.cookie;',
      "const c = request.headers.get('cookie');",
      "res.cookie('a', '1');",
      "fetch(u, { credentials: 'include' });",
    ];
    for (const line of uses) {
      const hits = cookieUsesIn(f, `const a = 1;\n${line}`);
      expect(hits, line).toHaveLength(1);
      expect(hits[0].line).toBe(2);
      expect(hits[0].instead).toBeTruthy();
    }
  });

  it('does not read a comment as a use, nor a word that is not one', () => {
    expect(cookieUsesIn('apps/basis/src/a.js', '// the cookie it was spent into\n * no document.cookie here\nconst cookieJar = 1;')).toEqual([]);
  });

  it('scans shipped code only', () => {
    expect(isShipped('apps/basis/src/v2/toolboxPages.js')).toBe(true);
    expect(isShipped('packages/transports/src/x.js')).toBe(true);
    expect(isShipped('apps/basis/test/x.test.js')).toBe(false);
    expect(isShipped('apps/basis/test-browser/x.spec.js')).toBe(false);
    expect(isShipped('apps/basis/scripts/settings-pod-css-harness.mjs')).toBe(false);
    expect(isShipped('apps/e2e-journeys/journeys/companion.journey.mjs')).toBe(false);
  });

  it('allows the one declared exception, and is red on the same use anywhere else', () => {
    expect(judge(new Map([[EXC, live]]))).toEqual({ red: [], stale: [] });
    const { red } = judge(new Map([[EXC, live], ['apps/basis/src/v2/other.js', live]]));
    expect(red).toHaveLength(1);
    expect(red[0]).toMatch(/^apps\/basis\/src\/v2\/other\.js:1: a Set-Cookie header → use /);
  });

  it('is red when the exception uses no cookie any more (a stale exception is a hole left open)', () => {
    expect(judge(new Map([[EXC, 'export const x = 1;']])).stale).toEqual([EXC]);
    expect(judge(new Map()).stale).toEqual([EXC]);
  });
});
