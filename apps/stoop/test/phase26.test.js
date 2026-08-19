/**
 * Stoop V2 — Phase 26 tests.
 *
 *   26.1  geo.js: cellFor, distanceKm, snapToGrid (pure)
 *   26.2  geocode skill with stubbed Nominatim HTTP
 *   26.3  setMyLocation / clearMyLocation / getMyLocation persist on
 *         MemberMap.location
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

import { cellFor, cellCenter, distanceKm, snapToGrid, DISTANCE_PRESETS } from '../src/lib/geo.js';
import { _setHttpFactory } from '../src/lib/geocode.js';
import { createNeighbourhoodAgent } from '../src/index.js';

const ANNE = 'https://id.example/anne';

async function callSkill(agent, skillId, args, fromWebid = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     fromWebid,
    agent,
    envelope: null,
  });
}

async function buildBundle() {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity: id, transport: tx,
    offeringMatch: { group: 'oosterpoort', localActor: ANNE, peers: [] },
    members:    [{ webid: ANNE }],
  });
  await bundle.offeringMatch.start();
  return bundle;
}

/* ── 26.1 geo.js ──────────────────────────────────────────────── */

describe('Stoop V2 Phase 26.1 — geo.js', () => {
  it('cellFor: same coords → same cell; nearby coords (within grid) → same cell', () => {
    const a = cellFor({ lat: 53.21, lng: 6.59, gridM: 500 });
    const b = cellFor({ lat: 53.21, lng: 6.59, gridM: 500 });
    expect(a).toBe(b);
    // ~50m away (rough): 0.0005 deg lat ≈ 55m → still same cell at 500m grid
    const c = cellFor({ lat: 53.2105, lng: 6.59, gridM: 500 });
    expect(c).toBe(a);
  });

  it('cellFor: cells differ at 1km separation', () => {
    const a = cellFor({ lat: 53.21, lng: 6.59, gridM: 500 });
    // 1 km north: ~0.009 deg lat
    const b = cellFor({ lat: 53.219, lng: 6.59, gridM: 500 });
    expect(a).not.toBe(b);
  });

  it('cellFor rejects out-of-range coords', () => {
    expect(() => cellFor({ lat: 91, lng: 0 })).toThrow();
    expect(() => cellFor({ lat: 0, lng: 181 })).toThrow();
  });

  it('cellCenter is approximately the inverse of cellFor', () => {
    const lat = 53.21, lng = 6.59;
    const cell = cellFor({ lat, lng, gridM: 500 });
    const c = cellCenter(cell);
    expect(c.lat).toBeCloseTo(lat, 1);   // within ~0.1 deg = ~11 km
    expect(c.lng).toBeCloseTo(lng, 1);
    expect(c.gridM).toBe(500);
  });

  it('distanceKm Amsterdam ↔ Groningen is ~150 km (great-circle)', () => {
    // Great-circle ~150 km; actual road ~180 km.  We measure great-
    // circle here.  Cell-encoding on a 500m grid introduces ~250m
    // rounding per side; tolerance covers that.
    const ams = cellFor({ lat: 52.37, lng: 4.90, gridM: 500 });   // Amsterdam
    const gro = cellFor({ lat: 53.22, lng: 6.57, gridM: 500 });   // Groningen
    const km = distanceKm(ams, gro);
    expect(km).toBeGreaterThan(130);
    expect(km).toBeLessThan(180);
  });

  it('distanceKm same cell = 0', () => {
    const a = cellFor({ lat: 53.21, lng: 6.59 });
    expect(distanceKm(a, a)).toBe(0);
  });

  it('distanceKm symmetric', () => {
    const a = cellFor({ lat: 52.37, lng: 4.90 });
    const b = cellFor({ lat: 53.22, lng: 6.57 });
    expect(distanceKm(a, b)).toBe(distanceKm(b, a));
  });

  it('snapToGrid clamps + picks closest preset', () => {
    expect(snapToGrid(0)).toBe(1);          // below smallest → smallest
    expect(snapToGrid(0.5)).toBe(1);
    expect(snapToGrid(2.4)).toBe(2);
    expect(snapToGrid(3)).toBe(2);          // 3 is closer to 2 than to 5 (diff 1 vs 2)
    expect(snapToGrid(7)).toBe(5);          // 7 closer to 5 than to 10 (diff 2 vs 3)
    expect(snapToGrid(100)).toBe(25);       // above largest → largest
  });

  it('DISTANCE_PRESETS = [1, 2, 5, 10, 25] — pinned for UI back-compat', () => {
    expect(DISTANCE_PRESETS).toEqual([1, 2, 5, 10, 25]);
  });
});

/* ── 26.2 geocode skill (stubbed HTTP) ────────────────────────── */

describe('Stoop V2 Phase 26.2 — geocode skill', () => {
  const NOMINATIM_RESP = [
    { lat: '53.2194', lon: '6.5665', display_name: 'Groningen, Nederland' },
  ];

  let calls;
  beforeEach(() => {
    calls = [];
    _setHttpFactory(async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true, status: 200,
        async json() { return NOMINATIM_RESP; },
      };
    });
  });
  afterEach(() => { _setHttpFactory(null); });

  it('returns cell + label + raw coords on success', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'geocode', { query: 'Groningen' });
    expect(r.cell).toMatch(/^500:/);
    expect(r.label).toBe('Groningen, Nederland');
    expect(r.source).toBe('geocode');
    expect(r.raw.lat).toBeCloseTo(53.2194);
    expect(r.raw.lng).toBeCloseTo(6.5665);
    expect(calls[0].url).toContain('q=Groningen');
  });

  it('rejects empty query', async () => {
    const bundle = await buildBundle();
    expect(await callSkill(bundle.agent, 'geocode', { query: '' }))
      .toEqual({ error: 'query required' });
  });

  it('reports HTTP failure as error', async () => {
    _setHttpFactory(async () => ({ ok: false, status: 503 }));
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'geocode', { query: 'X' });
    expect(r.error).toContain('status');
  });

  it('reports empty Nominatim result as no-result', async () => {
    _setHttpFactory(async () => ({ ok: true, async json() { return []; } }));
    const bundle = await buildBundle();
    expect(await callSkill(bundle.agent, 'geocode', { query: 'asdfghjkl' }))
      .toEqual({ error: 'no-result' });
  });
});

/* ── 26.3 location skills ─────────────────────────────────────── */

describe('Stoop V2 Phase 26.3 — location skills', () => {
  it('setMyLocation persists; getMyLocation reads back', async () => {
    const bundle = await buildBundle();
    const cell = cellFor({ lat: 53.22, lng: 6.57 });
    await callSkill(bundle.agent, 'setMyLocation', {
      cell, label: 'Groningen', source: 'geocode',
    });
    const r = await callSkill(bundle.agent, 'getMyLocation', {});
    expect(r.location.cell).toBe(cell);
    expect(r.location.label).toBe('Groningen');
    expect(r.location.source).toBe('geocode');
  });

  it('clearMyLocation resets to null', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'setMyLocation', {
      cell: cellFor({ lat: 0, lng: 0 }), label: 'Null Island',
    });
    await callSkill(bundle.agent, 'clearMyLocation', {});
    const r = await callSkill(bundle.agent, 'getMyLocation', {});
    expect(r.location).toBeNull();
  });

  it('rejects missing cell', async () => {
    const bundle = await buildBundle();
    expect(await callSkill(bundle.agent, 'setMyLocation', {}))
      .toEqual({ error: 'cell required' });
  });

  it('coerces invalid `source` to null', async () => {
    const bundle = await buildBundle();
    await callSkill(bundle.agent, 'setMyLocation', {
      cell: '500:0:0', label: 'X', source: 'evil-source',
    });
    const r = await callSkill(bundle.agent, 'getMyLocation', {});
    expect(r.location.source).toBeNull();
  });

  it('distancePresets skill returns the canonical list', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'distancePresets', {});
    expect(r.presets).toEqual([1, 2, 5, 10, 25]);
  });
});
