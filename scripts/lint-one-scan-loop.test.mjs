import { describe, it, expect } from 'vitest';
import { firstMatchLoops, importsReactNative } from './lint-one-scan-loop.mjs';

describe('lint-one-scan-loop', () => {
  it('finds a hand-rolled first-match loop over classifiers', () => {
    expect(firstMatchLoops('for (const c of SCAN_CLASSIFIERS) {\n  let p = null;\n  try { p = c.classify(s); } catch {}\n}')).toEqual([1]);
    expect(firstMatchLoops('for (const x of rows) { use(x); }')).toEqual([]);
  });
  it('names a React Native import', () => {
    expect(importsReactNative("import { View } from 'react-native';")).toBe(true);
    expect(importsReactNative("export { x } from '@onderling/react-native/qr';")).toBe(true);
    expect(importsReactNative("import { isPairCircleId } from './ids.js';")).toBe(false);
  });
});
