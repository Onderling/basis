/**
 * getItemTree — Phase 3.3c app-wiring. Stoop now *walks* embeds (it
 * already emitted them via postRequest). One agent-side skill serves
 * web + mobile (both thin A2A clients) — the platform-parity path.
 *
 * Asserts: source.embeds is bridged to treeOf's top-level shape;
 * https refs materialise; 401/403 → PERMISSION_DENIED placeholder
 * (the 3-tier render fallback); urn:dec:item: → local; bad input.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildSkills } from '../src/skills/index.js';

function skillsWith(itemMap) {
  const store = { getById: async (id) => itemMap[id] ?? null };
  const arr = buildSkills({
    store,
    offeringMatch: { broadcast: vi.fn(async () => ({ claims: [] })), addPeer: vi.fn() },
    notifier:   null,
    reveals:    null,
    members:    null,
    muted:      new Set(),
    localActor: 'urn:me',
    groupId:    'g1',
    chat:       null,
    metrics:    null,
    bundle:     {},
  });
  return arr.find((s) => s.id === 'getItemTree');
}

const call = (skill, itemId) =>
  skill.handler({ parts: [{ type: 'DataPart', data: { itemId } }], from: 'urn:me' });

afterEach(() => vi.unstubAllGlobals());

describe('getItemTree skill (Phase 3.3c wiring)', () => {
  it('bridges source.embeds and materialises an https cross-pod ref', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      text: async () => '{"id":"X","type":"item","text":"bob’s offer"}',
    })));
    // Stoop persists embeds under source.embeds — not top-level.
    const skill = skillsWith({
      R: { id: 'R', type: 'request', source: { embeds: [{ type: 'item', ref: 'https://bob.pod/circle/items/X.json' }] } },
    });
    const { tree, error } = await call(skill, 'R');
    expect(error).toBeUndefined();
    expect(tree.id).toBe('R');
    expect(tree.source).toBe('local');
    expect(tree.embeds).toHaveLength(1);
    expect(tree.embeds[0].source).toBe('external');
    expect(tree.embeds[0].item).toEqual({ id: 'X', type: 'item', text: 'bob’s offer' });
  });

  it('403 on a cross-pod ref → PERMISSION_DENIED placeholder (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403 })));
    const skill = skillsWith({
      R: { id: 'R', type: 'request', source: { embeds: [{ type: 'item', ref: 'https://bob.pod/x' }] } },
    });
    const { tree, error } = await call(skill, 'R');
    expect(error).toBeUndefined();
    expect(tree.embeds[0].source).toBe('placeholder');
    expect(tree.embeds[0].reason).toBe('PERMISSION_DENIED');
    expect(tree.embeds[0].ref).toBe('https://bob.pod/x');
  });

  it('urn:dec:item: ref resolves via the local store', async () => {
    const skill = skillsWith({
      R: { id: 'R', type: 'request', source: { embeds: [{ type: 'item', ref: 'urn:dec:item:L2' }] } },
      L2: { id: 'L2', type: 'offer', text: 'local sibling' },
    });
    const { tree } = await call(skill, 'R');
    expect(tree.embeds[0].source).toBe('external');
    expect(tree.embeds[0].item.id).toBe('L2');
  });

  it('no embeds → empty embeds array; missing itemId → error', async () => {
    const skill = skillsWith({ R: { id: 'R', type: 'request' } });
    const { tree } = await call(skill, 'R');
    expect(tree.embeds).toEqual([]);
    expect((await skill.handler({ parts: [{ type: 'DataPart', data: {} }] })).error)
      .toMatch(/itemId/);
  });
});
