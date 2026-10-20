import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { scanSource, styledBy } from './lint-unstyled-buttons.mjs';

const isStyled = styledBy('.cc-btn { } .cc-btn--quiet { } .row__act { }');

describe('lint-unstyled-buttons', () => {
  it('counts a button with no class, or only classes no stylesheet styles', () => {
    const src = [
      "const a = document.createElement('button');",
      "a.textContent = 'x';",
      "const b = document.createElement('button');",
      "b.className = 'nobody__styles-this';",
    ].join('\n');
    expect(scanSource(src, isStyled).map((h) => h.name)).toEqual(['a', 'b']);
  });
  it('passes a button that wears the family or a styled class (className or classList)', () => {
    const src = [
      "const a = document.createElement('button');",
      "a.className = 'cc-btn cc-btn--quiet whatever';",
      "const b = document.createElement('button');",
      "b.classList.add('row__act');",
      "const c = document.createElement('button');",
      "c.className = `cc-btn ${extra}`;",
    ].join('\n');
    expect(scanSource(src, isStyled)).toEqual([]);
  });
  it('passes on the repo as it stands', () => {
    const r = spawnSync(process.execPath, ['scripts/lint-unstyled-buttons.mjs'], { encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
  });
});
