import { describe, it, expect } from 'vitest';
import { entries, citedDecisions, decisionsProblems } from './lint-decisions.mjs';

const DEC = ['# Decisions', '', '## 2026-07-31 — A', 'x', '## B (2026-08-19, Frits)', 'y', '## 2026-08-27 — C', 'z'].join('\n');

describe('lint-decisions', () => {
  it('reads each heading\'s date, in either heading form', () => {
    expect(entries(DEC).map((e) => e.date)).toEqual(['2026-07-31', '2026-08-19', '2026-08-27']);
  });
  it('reads the decisions architecture.md cites', () => {
    expect(citedDecisions('ACP (decided 2026-08-27). Also decided on 2026-08-19, and decided 2026-08-27 again.')).toEqual(['2026-08-19', '2026-08-27']);
  });
  it('is quiet when entries are in order and every citation is backed', () => {
    expect(decisionsProblems(DEC, '(decided 2026-08-27)')).toEqual([]);
  });
  it('is red for an entry out of date order', () => {
    const out = DEC.replace('## 2026-08-27 — C', '## 2026-08-01 — C');
    expect(decisionsProblems(out, '').join('\n')).toMatch(/\(2026-08-01\) comes after 2026-08-19/);
  });
  it('is red for a cited decision with no entry, and for an undated heading', () => {
    expect(decisionsProblems(DEC, '(decided 2026-08-26)').join('\n')).toMatch(/cites a decision of 2026-08-26/);
    expect(decisionsProblems(`${DEC}\n## No date here`, '').join('\n')).toMatch(/has no date in its heading/);
  });
});
