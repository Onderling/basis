/**
 * The phone shows the circle's lists block as the web does (the shared materializer fills it), where a person's own
 * screen recipe carries it; the circle's lists themselves are its Lists tab (circleListsTab.test.js).
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
  it('the recipe palette is given the circle policy', () => {
    expect(read('../src/screens/v2/CircleRecipeEditorScreen.js')).toMatch(/blockTypesFor\('circle', \{ policy \}\)/);
  });
});
