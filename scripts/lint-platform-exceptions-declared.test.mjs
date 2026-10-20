import { describe, it, expect } from 'vitest';
import { onePlatformIds, meshTabIds, declaredIds } from './lint-platform-exceptions-declared.mjs';

describe('lint-platform-exceptions-declared', () => {
  it('a one-shell platforms tag is one-platform; both shells is not', () => {
    expect(onePlatformIds("{ id: 'share', target: {}, platforms: ['mobile'] },\n{ id: 'x', platforms: ['web', 'mobile'] }")).toEqual(['share']);
  });
  it('reads the mesh tabs', () => {
    expect(meshTabIds("export const MESH_TABS = Object.freeze(['nearby']);")).toEqual(['nearby']);
  });
  it('a row declares the ids it backticks, only under the listed exceptions', () => {
    const doc = '## May differ\n| `notme` |\n## Current listed exceptions\n| The tab (`nearby`) | mobile only |\n';
    expect([...declaredIds(doc)]).toEqual(['nearby']);
  });
});
