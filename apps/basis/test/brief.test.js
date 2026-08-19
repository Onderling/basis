/**
 * basis — /brief aggregator tests. v0.7.
 */
import { describe, it, expect, vi } from 'vitest';

import { runBrief, createBriefCache } from '../src/brief.js';

function makeCatalog(decls) {
  // decls: [{ opId, appOrigin, summarySkill, order?, label? }, ...]
  return {
    briefAggregations: () => decls,
  };
}

describe('runBrief — fan-out', () => {
  it("fans across declared apps + returns ordered sections", async () => {
    const catalog = makeCatalog([
      { opId: 'listOpen',  appOrigin: 'household', summarySkill: 'bs1', order: 10, label: 'Household' },
      { opId: 'listFeed',  appOrigin: 'stoop',     summarySkill: 'bs2', order: 30, label: 'Circle' },
      { opId: 'readNote',  appOrigin: 'folio',     summarySkill: 'bs3', order: 20, label: 'Folio' },
    ]);
    const calls = [];
    const callSkill = async (appOrigin, skill) => {
      calls.push({ appOrigin, skill });
      return { items: [{ id: 'x', label: `${appOrigin}-x` }] };
    };
    const r = await runBrief({ catalog, callSkill });
    expect(r.sections.map((s) => s.appOrigin)).toEqual(['household', 'folio', 'stoop']);
    expect(r.sections.map((s) => s.label)).toEqual(['Household', 'Folio', 'Circle']);
    expect(calls.length).toBe(3);
  });

  it("skips empty payloads (per design doc)", async () => {
    const catalog = makeCatalog([
      { opId: 'a', appOrigin: 'a', summarySkill: 's', order: 1 },
      { opId: 'b', appOrigin: 'b', summarySkill: 's', order: 2 },
      { opId: 'c', appOrigin: 'c', summarySkill: 's', order: 3 },
    ]);
    const callSkill = async (appOrigin) => {
      if (appOrigin === 'a') return { items: [] };                   // empty list
      if (appOrigin === 'b') return null;                            // null
      if (appOrigin === 'c') return { items: [{ id: 'x' }] };        // has content
    };
    const r = await runBrief({ catalog, callSkill });
    expect(r.sections.length).toBe(1);
    expect(r.sections[0].appOrigin).toBe('c');
  });

  it("captures errors per-section instead of failing the whole brief", async () => {
    const catalog = makeCatalog([
      { opId: 'a', appOrigin: 'a', summarySkill: 's', order: 1 },
      { opId: 'b', appOrigin: 'b', summarySkill: 's', order: 2 },
    ]);
    const callSkill = async (appOrigin) => {
      if (appOrigin === 'a') throw new Error('boom');
      return { items: [{ id: 'x' }] };
    };
    const r = await runBrief({ catalog, callSkill });
    expect(r.sections.length).toBe(2);
    const errored = r.sections.find((s) => s.appOrigin === 'a');
    expect(errored.error).toMatch(/boom/);
    expect(errored.payload).toBeNull();
  });

  it("rejects null catalog / non-function callSkill", async () => {
    await expect(runBrief({ catalog: null, callSkill: () => {} }))
      .rejects.toThrow(/catalog/);
    await expect(runBrief({ catalog: makeCatalog([]), callSkill: null }))
      .rejects.toThrow(/callSkill/);
  });

  it("returns a cacheKey + generatedAt timestamp", async () => {
    const r = await runBrief({
      catalog: makeCatalog([{ opId: 'a', appOrigin: 'a', summarySkill: 's' }]),
      callSkill: async () => ({ items: [{ id: 'x' }] }),
    });
    expect(typeof r.generatedAt).toBe('number');
    expect(typeof r.cacheKey).toBe('string');
  });
});

describe('createBriefCache (OQ-7.A: 60s TTL)', () => {
  it("default ttl is 60s", () => {
    expect(createBriefCache().ttlMs).toBe(60_000);
  });

  it("get returns set value within TTL", () => {
    const now = vi.fn(() => 1_000);
    const cache = createBriefCache({ ttlMs: 1000, now });
    cache.set({ sections: [{ appOrigin: 'a', label: 'A', order: 1, payload: {} }] });
    expect(cache.get()?.sections.length).toBe(1);
  });

  it("expires after ttl", () => {
    let clock = 0;
    const cache = createBriefCache({ ttlMs: 1000, now: () => clock });
    cache.set({ sections: [] });
    clock = 999;  expect(cache.get()).not.toBeNull();
    clock = 1001; expect(cache.get()).toBeNull();
  });

  it("clear nulls the entry", () => {
    const cache = createBriefCache({ ttlMs: 60000 });
    cache.set({ sections: [] });
    cache.clear();
    expect(cache.get()).toBeNull();
  });
});

describe('runBrief — cache interaction', () => {
  it("uses cached value when present + not bypassed", async () => {
    const cache = createBriefCache({ ttlMs: 60000 });
    const callSkill = vi.fn(async () => ({ items: [{ id: 'x' }] }));
    const catalog = makeCatalog([{ opId: 'a', appOrigin: 'a', summarySkill: 's' }]);
    await runBrief({ catalog, callSkill, cache });
    await runBrief({ catalog, callSkill, cache });
    expect(callSkill).toHaveBeenCalledTimes(1);   // 2nd call served from cache
  });

  it("bypassCache: true re-runs", async () => {
    const cache = createBriefCache({ ttlMs: 60000 });
    const callSkill = vi.fn(async () => ({ items: [{ id: 'x' }] }));
    const catalog = makeCatalog([{ opId: 'a', appOrigin: 'a', summarySkill: 's' }]);
    await runBrief({ catalog, callSkill, cache });
    await runBrief({ catalog, callSkill, cache, bypassCache: true });
    expect(callSkill).toHaveBeenCalledTimes(2);
  });
});
