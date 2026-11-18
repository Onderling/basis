/**
 * Nothing the web app runs comes from another origin (ledger L1041).
 *
 * @guard the web app's page loads no script, stylesheet or frame from another origin, and the NKN library it runs is the installed one, built in beside it
 *
 * A browser separates pages by origin, never by path: a script running on the web app's origin can use the keys that
 * origin keeps (the root key's wrap key is usable by any same-origin code, `packages/vault/src/RootKeyStoreWebCrypto.js`).
 * Until 2026-11-18 the page loaded `nkn-sdk` 1.3.4 from a CDN, without an integrity hash, while the transport is tested
 * against the installed 1.3.6.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const HTML = readFileSync(fileURLToPath(new URL('../web/index.html', import.meta.url)), 'utf8');
// every src/href in a tag that loads code or style (comments dropped: they may name what was there)
const loads = (html) => [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(script|link|iframe|img|object|embed)\b[^>]*?\b(?:src|href)\s*=\s*"([^"]*)"/gi)].map((m) => ({ tag: m[1], url: m[2] }));

describe('the web app\'s page', () => {
  it('loads nothing from another origin', () => {
    const foreign = loads(HTML).filter(({ url }) => /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url));
    expect(foreign, `from another origin: ${JSON.stringify(foreign)}`).toEqual([]);
  });

  it('runs the installed NKN library, built in beside it (the same file the transport is tested with)', async () => {
    expect(loads(HTML).map((l) => l.url)).toContain('./vendor/nkn.min.js');
    const { SAME_ORIGIN_NKN, NKN_FILE } = await import('../vite.config.js');
    expect(SAME_ORIGIN_NKN).toBe('vendor/nkn.min.js');
    expect(NKN_FILE.replace(/\\/g, '/')).toMatch(/\/nkn-sdk\/dist\/nkn\.min\.js$/);
    const declared = JSON.parse(readFileSync(fileURLToPath(new URL('../../../packages/transports/package.json', import.meta.url)), 'utf8')).optionalDependencies['nkn-sdk'];
    const installed = JSON.parse(readFileSync(NKN_FILE.replace(/dist[\\/]nkn\.min\.js$/, 'package.json'), 'utf8')).version;
    expect(installed.split('.')[0], `nkn-sdk ${installed} against the transport's ${declared}`).toBe(declared.replace(/^[^\d]*/, '').split('.')[0]);
  });
});
