/**
 * FITNESS — EVERY canonical item type crosses the sync seam. No type is silently exempt.
 *
 * A circle owns one store; a store holds typed items; and **whatever the store holds is what syncs to the
 * circle's other members** (docs/architecture.md §3, "The data plane"). That last clause is the one that
 * keeps not being true, and it fails silently every time: a type is written, read, and rendered perfectly
 * on the device that wrote it, while no peer ever hears about it.
 *
 * It has now happened twice with the same shape. Chat messages were delivered and stored and never
 * rendered, because nothing told the open view to repaint. Tasks were scoped per circle correctly and
 * never mirrored, because their store was not on the fan-out path — the circle's mirror sat wired and
 * paired with nothing to send. In both cases every unit test passed, because every unit test asked
 * whether the LOCAL side worked.
 *
 * So this test is deliberately generated FROM the type registry rather than written per type: a new
 * canonical type is covered the day it is declared, and cannot be forgotten. If you add a type and this
 * fails, the type has no sync story yet — that is the finding, not a broken test.
 *
 * ── What this proves, and what it does not ────────────────────────────────────────────────────────────
 * PROVES: the publish-on-write seam fires for every declared type, and an item that crosses is ingested
 * into a second store with its identity intact — the two halves that make a type shareable AT ALL.
 * DOES NOT PROVE: that a given app's write path reaches a mirrored store. That is a wiring question one
 * layer up, and it is exactly how tasks went missing. The companion for that is the per-circle
 * store-uniqueness guard; this one holds the substrate contract those depend on.
 */

import { describe, it, expect, vi } from 'vitest';
import { CircleItemStore } from '../src/CircleItemStore.js';
import { memoryDataSource } from '../src/memoryDataSource.js';
import { wireStoreMirror } from '../src/mirrorSync.js';
import { CANONICAL_TYPES } from '@onderling/item-types';

const store = (root) => new CircleItemStore({ dataSource: memoryDataSource(), rootContainer: root });

/** Fields the STORE assigns — a caller never supplies them, so a fixture must not either. */
const STORE_ASSIGNED = new Set(['type', 'id', 'createdAt', 'createdBy', 'updatedAt']);

/**
 * Build a minimal item that satisfies a type's schema, from the schema itself.
 * Generated rather than hand-written so a new canonical type needs no new fixture — the thing that makes
 * "cannot be forgotten" true rather than aspirational.
 */
function fixtureFor(name, schema) {
  const props = schema?.properties ?? {};
  const item = { type: name };
  for (const field of schema?.required ?? []) {
    if (STORE_ASSIGNED.has(field)) continue;
    item[field] = sampleFor(props[field], field);
  }
  return item;
}

function sampleFor(spec, field) {
  if (!spec || typeof spec !== 'object') return `sample-${field}`;
  if (spec.const !== undefined) return spec.const;
  if (Array.isArray(spec.enum) && spec.enum.length) return spec.enum[0];
  switch (spec.type) {
    case 'array':   return [];
    case 'object':  return {};
    case 'number':
    case 'integer': return 1;
    case 'boolean': return true;
    default:
      // date-time strings must parse, or a schema-validating store rejects the fixture
      return spec.format === 'date-time' ? new Date(0).toISOString() : `sample-${field}`;
  }
}

const TYPES = Object.entries(CANONICAL_TYPES ?? {})
  .filter(([, schema]) => schema && typeof schema === 'object' && schema.properties);

describe('FITNESS — every canonical type crosses the sync seam', () => {
  it('finds the canonical type registry at all', () => {
    // a matrix that silently covers nothing is worse than no matrix
    expect(TYPES.length).toBeGreaterThan(5);
  });

  for (const [name, schema] of TYPES) {
    it(`${name} — a local write PUBLISHES`, async () => {
      const a = store('mem://a/');
      const publishItem = vi.fn();
      wireStoreMirror(a, { publishItem, publishItemRemoved: vi.fn() });

      const written = await a.put(fixtureFor(name, schema));

      expect(publishItem, `writing a "${name}" published nothing — this type cannot reach a peer`)
        .toHaveBeenCalledWith(expect.objectContaining({ id: written.id, type: name }));
    });

    it(`${name} — a published item INGESTS into another store, identity intact`, async () => {
      const a = store('mem://a/');
      const b = store('mem://b/');
      let captured = null;
      wireStoreMirror(a, { publishItem: (item) => { captured = item; }, publishItemRemoved: vi.fn() });

      const written = await a.put(fixtureFor(name, schema));
      expect(captured, `"${name}" produced no envelope to ingest`).toBeTruthy();

      // The receiving side of the real seam: id-preserving, and `sync:false` so an ingest does not
      // re-publish (the echo that would otherwise loop two peers forever).
      await b.put(captured, { origin: true, sync: false });

      const landed = await b.get(written.id);
      expect(landed, `"${name}" did not survive the crossing`).toBeTruthy();
      expect(landed.id).toBe(written.id);      // same item, not a copy with a new identity
      expect(landed.type).toBe(name);
    });
  }

  it('an INGEST never re-publishes — two peers must not echo forever', async () => {
    const b = store('mem://b/');
    const publishItem = vi.fn();
    wireStoreMirror(b, { publishItem, publishItemRemoved: vi.fn() });
    await b.put({ type: 'note', text: 'from a peer', id: 'note-1' }, { origin: true, sync: false });
    expect(publishItem).not.toHaveBeenCalled();
  });
});
