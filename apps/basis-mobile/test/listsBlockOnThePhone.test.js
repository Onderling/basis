/**
 * The phone shows the circle's lists block as the web does (the shared materializer fills it): the screen paints a
 * 'lists' block, and the circle's "+" offers making a list only where the screen carries that block.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('the lists block on the phone', () => {
  it('the circle screen paints a lists block, each entry with its one act', () => {
    const src = read('../src/screens/v2/CircleScreenView.js');
    expect(src).toMatch(/case 'lists':\s+body = renderLists\(/);
    expect(src).toMatch(/<PrimaryButton item=\{e\} noun="list-item"/);
  });
  it("the circle's '+' is told which blocks are on the screen", () => {
    expect(read('../src/screens/v2/CircleLauncherScreen.js')).toMatch(/blockTypes: \(screenBlocks \?\? \[\]\)\.map/);
  });
  it('the recipe palette is given the circle policy', () => {
    expect(read('../src/screens/v2/CircleRecipeEditorScreen.js')).toMatch(/blockTypesFor\('circle', \{ policy \}\)/);
  });
});
