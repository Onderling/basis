import { describe, it, expect } from 'vitest';
import { keysIn, dynamicPrefixesIn, declaredKeys, covers, localeKeys } from './lint-locale-key-parity.mjs';

describe('lint-locale-key-parity', () => {
  const known = new Set(['circle.fileShare.download', 'circle.share.stop', 'circle.scope.self']);
  it('a key reaches a screen by t(), as a labelKey, or in a map — any quoted known key counts', () => {
    expect(keysIn("t('circle.fileShare.download'); x = { labelKey: \"circle.share.stop\" }; y = 'circle.nope'", known))
      .toEqual(['circle.fileShare.download', 'circle.share.stop']);
  });
  it('a prefix built at run time is read', () => {
    expect(dynamicPrefixesIn('tr(`circle.scope.${scope}`); t(\'circle.role.\' + r)')).toEqual(['circle.scope.', 'circle.role.']);
  });
  it('the exceptions table declares keys and prefixes, only under its listed exceptions', () => {
    const doc = '## May differ\n| `circle.not.me` |\n## Current listed exceptions\n| first run (`circle.firstRun.*`) | mobile | `circle.share.stop` |\n';
    expect(declaredKeys(doc)).toEqual(['circle.firstRun.*', 'circle.share.stop']);
    expect(covers('circle.firstRun.*', 'circle.firstRun.start')).toBe(true);
    expect(covers('circle.share.stop', 'circle.share.stopx')).toBe(false);
  });
  it('reads a bundle\'s leaf keys', () => {
    expect([...localeKeys({ circle: { a: { text: 'A' }, b: { c: { text: 'C', doc: 'd' } } } })]).toEqual(['circle.a', 'circle.b.c']);
  });
});
