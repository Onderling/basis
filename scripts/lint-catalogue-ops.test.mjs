import { describe, it, expect } from 'vitest';
import { opsOnPage, auditCatalogue, shrunkBaseline } from './lint-catalogue-ops.mjs';

const declared = new Set(['tasks.addTask', 'tasks.claimTask', 'household.addItem']);

describe('lint-catalogue-ops', () => {
  it('reads a page\'s catalogue-ops block', () => {
    expect(opsOnPage('# x\n<!-- catalogue-ops\ntasks: addTask claimTask\nhousehold: addItem\n-->\n')).toEqual(['tasks.addTask', 'tasks.claimTask', 'household.addItem']);
  });
  it('is green when every op is on one page or owed', () => {
    expect(auditCatalogue({ declared, pages: { 'a.md': ['tasks.addTask', 'tasks.claimTask'] }, baseline: ['household.addItem'] })).toEqual([]);
  });
  it('is red for an op on two pages, an unknown op, an op on none, and a stale baseline entry', () => {
    const p = auditCatalogue({ declared, pages: { 'a.md': ['tasks.addTask', 'tasks.gone'], 'b.md': ['tasks.addTask'] }, baseline: ['tasks.addTask', 'tasks.old'] });
    expect(p.some((x) => /tasks.addTask is named on 2 pages/.test(x))).toBe(true);
    expect(p.some((x) => /names tasks.gone/.test(x))).toBe(true);
    expect(p.some((x) => /tasks.claimTask is on no catalogue page/.test(x))).toBe(true);
    expect(p.some((x) => /household.addItem is on no catalogue page/.test(x))).toBe(true);
    expect(p.some((x) => /baseline lists tasks.addTask, which is now on/.test(x))).toBe(true);
    expect(p.some((x) => /baseline lists tasks.old, which no manifest declares/.test(x))).toBe(true);
  });

  it('every red message says what to do instead; one on a page or in the baseline names its file:line', () => {
    const texts = {
      'a.md': '# A\n<!-- catalogue-ops\ntasks: addTask gone\n-->\n',
      'b.md': '# B\n\n<!-- catalogue-ops\ntasks: addTask\n-->\n',
      baseline: '{\n  "owed": [\n    "tasks.addTask",\n    "tasks.old"\n  ]\n}\n',
    };
    const p = auditCatalogue({ declared, pages: { 'a.md': ['tasks.addTask', 'tasks.gone'], 'b.md': ['tasks.addTask'] }, baseline: ['tasks.addTask', 'tasks.old'], texts });
    for (const x of p) expect(x).toMatch(/\n\s*Fix: /);
    expect(p.find((x) => /names tasks\.gone/.test(x))).toMatch(/docs\/catalogue\/a\.md:3:/);
    expect(p.find((x) => /named on 2 pages/.test(x))).toMatch(/docs\/catalogue\/b\.md:4/);
    expect(p.find((x) => /baseline lists tasks\.old/.test(x))).toMatch(/scripts\/catalogue-ops-baseline\.json:4:/);
  });

  // --update may only SHRINK the debt: a new op on no page is never written into the baseline, it stays red
  it('--update removes placed and gone entries, and never adds a new unplaced op', () => {
    const declared2 = new Set(['tasks.addTask', 'tasks.claimTask', 'tasks.brandNew']);
    const owed = shrunkBaseline({ declared: declared2, pages: { 'a.md': ['tasks.addTask'] }, baseline: ['tasks.addTask', 'tasks.claimTask', 'tasks.old'] });
    expect(owed).toEqual(['tasks.claimTask']);
    const p = auditCatalogue({ declared: declared2, pages: { 'a.md': ['tasks.addTask'] }, baseline: owed });
    expect(p.some((x) => /tasks.brandNew is on no catalogue page/.test(x))).toBe(true);
  });
});
