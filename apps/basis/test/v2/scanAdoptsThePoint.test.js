/**
 * A DEVICE WITH NO RELAY ADOPTS THE CONNECTION POINT A SCANNED CARD BRINGS, AND SAYS SO.
 *
 * Found 2026-11-06: a scanned card's relays became the CONTACT's points, and a device with no relay of its own dialled the
 * first only at its first send to that contact: silently, not at scan time, and not saved, so after a restart it was
 * unreachable again. Frits (2026-10-30): the relay travels with every share and the receiving phone adopts it. So at the
 * scan, a device that knows no relay saves the card's first point as its own (adopted, so the boot choice reconnects to
 * it after a restart), dials it, and says once whose point it now uses. A device that has one keeps its own.
 */
import { describe, it, expect } from 'vitest';
import { createConnectionPoints, adoptInheritedPoint, bootRelayUrl, POINT_SOURCE } from '../../src/v2/connectionPoints.js';
import { addContactAs } from '../../src/v2/contactLens.js';

const t = (k, p = {}) => `[${k}]${p.name ? `(${p.name})` : ''}`;
const URL = 'wss://relay.bea.example';

describe('adoptInheritedPoint', () => {
  it('a device that knows no relay adopts the card\'s first point, dials it, and says whose it is', async () => {
    const store = createConnectionPoints();
    const dialled = [];
    const r = await adoptInheritedPoint({ store, knowsRelay: false, points: [URL, 'wss://second.example'], dial: async (u) => { dialled.push(u); return { ok: true }; }, name: 'Bea', t });
    expect(r.adopted).toBe(URL);
    expect(dialled).toEqual([URL]);
    expect(r.say).toBe('[circle.nearbyScreen.point_adopted_from](Bea)');
    const p = store.list().find((x) => x.url === URL);
    expect(p).toMatchObject({ source: POINT_SOURCE.CONTACT, adopted: true });
    expect(store.activeUrl()).toBe(URL);
    // after a restart the boot choice reconnects to it
    expect(bootRelayUrl({ stored: null, list: store.list() })).toBe(URL);
  });
  it('a device with a relay of its own keeps it: nothing adopted, nothing said', async () => {
    const store = createConnectionPoints();
    const r = await adoptInheritedPoint({ store, knowsRelay: true, points: [URL], dial: async () => { throw new Error('must not dial'); }, name: 'Bea', t });
    expect(r).toEqual({ adopted: null, say: null });
    expect(store.list()).toHaveLength(0);
  });
  it('a card with no point adopts nothing', async () => {
    const r = await adoptInheritedPoint({ store: createConnectionPoints(), knowsRelay: false, points: [], dial: async () => ({}), name: 'Bea', t });
    expect(r.adopted).toBeNull();
  });
});

describe('addContactAs runs the adoption after the add', () => {
  it('hands the added contact to adoptPoint and returns what it said', async () => {
    const seen = [];
    const callSkill = async () => ({ contact: { webid: 'webid:bea', name: 'Bea', points: [URL] } });
    const r = await addContactAs({ callSkill, payload: 'not-a-card', adoptPoint: async (c) => { seen.push(c); return { adopted: URL, say: 'said' }; } });
    expect(seen[0]?.points).toEqual([URL]);
    expect(r.adoptedSay).toBe('said');
  });
});
