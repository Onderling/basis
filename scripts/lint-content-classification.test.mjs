import { describe, it, expect } from 'vitest';
import { storeSites, redMessage } from './lint-content-classification.mjs';

describe('lint-content-classification', () => {
  it('finds each named store with its line, past comments that span lines and hold apostrophes', () => {
    const src = [
      "/* the person's content,",
      "   web's stores */",
      "const a = pickWebBackend('cc-notes');",
      "// scope: 'not-this'",
      "const b = open({ dbName: 'cc-feeds' });",
    ].join('\n');
    expect(storeSites(src, [/pickWebBackend\(\s*'([^']+)'/g, /dbName:\s*'([^']+)'/g])).toEqual([
      { name: 'cc-notes', line: 3 },
      { name: 'cc-feeds', line: 5 },
    ]);
  });
  it('the red message names each store as file:line and says what to do instead', () => {
    const msg = redMessage([{ name: 'cc-notes', file: 'apps/basis/web/v2/circleApp.js', line: 3 }]);
    expect(msg).toMatch(/apps\/basis\/web\/v2\/circleApp\.js:3\b/);
    expect(msg).toMatch(/Fix: .*storageRegister\.js/);
  });
});
