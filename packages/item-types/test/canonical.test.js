/**
 * Canonical types — validation per-type.
 *
 * Sanity-checks that every shipped canonical type:
 *   - Registers cleanly via registerCanonicalTypes().
 *   - Accepts a minimal valid item.
 *   - Rejects missing-required-field cases.
 *   - Exposes its iri metadata.
 *
 * Sweep test — one minimal positive + one negative per type.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createRegistry,
  registerCanonicalTypes,
  CANONICAL_TYPES,
  list,
  validate,
  metadata,
  schema,
  NAMESPACE,
} from '../index.js';

const NOW = '2026-05-11T10:00:00.000Z';
const AGENT = 'https://anne.example/profile#me/agent/laptop';

/** Build a baseline item with the common required fields populated. */
function baseItem(type, extra = {}) {
  return {
    type,
    id:        `dec:item/${type}/abc`,
    createdAt: NOW,
    createdBy: AGENT,
    ...extra,
  };
}

describe('Canonical types — registration via default registry', () => {
  it('the default registry has all 17 canonical types', () => {
    expect(list().sort()).toEqual([
      'announcement',
      'calendar-event',
      'chat-message',
      'chat-thread',
      'circle',
      'claim',
      'contact',
      'inbox-item',
      'media',
      'neighbourhood-job',
      'note',
      'offer',
      'request',
      'reveal-request',
      'shared-ref',
      'task',
      'view',
    ]);
  });

  it('every canonical type exposes a `dec:` IRI', () => {
    for (const name of list()) {
      const m = metadata(name);
      expect(m).toBeTruthy();
      expect(m.iri).toMatch(new RegExp(`^${NAMESPACE.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`));
    }
  });

  it('registerCanonicalTypes works on a fresh registry too', () => {
    const r = createRegistry();
    registerCanonicalTypes(r);
    expect(r.list()).toHaveLength(17);
  });

  it('CANONICAL_TYPES exports the schema map', () => {
    expect(Object.keys(CANONICAL_TYPES)).toHaveLength(17);
    expect(CANONICAL_TYPES.task).toBeTruthy();
    expect(CANONICAL_TYPES.note).toBeTruthy();
  });
});

describe('Canonical types — minimal valid + missing-required-field sweep', () => {
  // Per-type minimal-valid extras to satisfy each schema's required fields.
  const MINIMAL = {
    'task':              { text:        'paint the fence' },
    'note':              { body:        'hello world' },
    'chat-message':      { body:        'hi!' },
    'chat-thread':       { name:        'Main' },
    'offer':             { body:        'ladder available, lend it to whoever needs it' },
    'request':           { body:        'looking to borrow a drill this weekend' },
    'claim':             { itemRef:     'pseudo-pod://x/y/z' },
    'contact':           { displayName: 'Anne' },
    'calendar-event':    { title:       'Coffee', startsAt: NOW },
    'announcement':      { body:        'Heads up: code rotates Friday' },
    'reveal-request':    { requester:   'pk-a', target: 'pk-b' },
    'neighbourhood-job': { body:        'paint the wall' },
    // V0 additions (2026-05-20):
    'view':              { title:       'Open tasks', itemType: 'task' },
    'circle':            { name:        'Gardening circle' },
    // cross-circle share reference.
    'shared-ref':        { sourceCircle: 'circle-a', sourceId: 'dec:item/task/abc' },
    // Media Phase 1 (2026-07-09): pointer-only media item.
    'media':             { source: { type: 'blob', ref: 'blob://abc123' } },
    // The subtask negotiation's noun — `kind` is what it waits for, and is required.
    'inbox-item':        { kind: 'subtask-proposal' },
  };

  for (const [name, extra] of Object.entries(MINIMAL)) {
    it(`'${name}' validates a minimal item`, () => {
      const result = validate(baseItem(name, extra));
      if (!result.ok) {
        console.error(`unexpected fail for '${name}':`, result.errors);
      }
      expect(result.ok).toBe(true);
    });

    it(`'${name}' fails when a base required field is missing`, () => {
      const item = baseItem(name, extra);
      delete item.createdAt;
      const result = validate(item);
      expect(result.ok).toBe(false);
    });

    it(`'${name}' fails when an item-specific required field is missing`, () => {
      // Drop one required type-specific field per type.
      const dropKey = Object.keys(extra)[0];
      const item = baseItem(name, extra);
      delete item[dropKey];
      const result = validate(item);
      expect(result.ok).toBe(false);
    });
  }
});

describe('Canonical types — embeds field shape', () => {
  it('accepts a well-formed embeds array', () => {
    const result = validate(baseItem('task', {
      text:   'paint the fence',
      embeds: [
        { type: 'note',  ref: 'https://anne.pod/notes/x' },
        { type: 'offer', ref: 'pseudo-pod://anne-device/offers/abc' },
      ],
    }));
    expect(result.ok).toBe(true);
  });

  it('rejects an embed missing the ref field', () => {
    const result = validate(baseItem('task', {
      text:   'x',
      embeds: [{ type: 'note' }],
    }));
    expect(result.ok).toBe(false);
  });

  it('accepts an embed with extra forward-compat fields', () => {
    const result = validate(baseItem('task', {
      text:   'x',
      embeds: [{ type: 'note', ref: 'https://x/y', sourceVersion: 'v3', cachedAt: NOW }],
    }));
    expect(result.ok).toBe(true);
  });
});

describe('Canonical types — extra-fields tolerance (forward-compat)', () => {
  it('allows undeclared fields on a task', () => {
    const result = validate(baseItem('task', {
      text: 'x',
      futureField:    'tomorrow this might be canonical',
      anotherFuture:  { nested: 'shape' },
    }));
    expect(result.ok).toBe(true);
  });
});

describe('media type (Media Phase 1, 2026-07-09)', () => {
  const SOURCE = { type: 'blob', ref: 'blob://bucket-key-1' };

  it('validates a full image item round-trip (source + hints + caption + embeds)', () => {
    const item = baseItem('media', {
      source:  { ...SOURCE, enc: { sealed: true, keyRef: 'circle:gardening', format: 'fp1', bytes: 12345 } },
      mime:    'image/jpeg',
      width:   800,
      height:  600,
      caption: 'the fence, freshly painted',
      embeds:  [{ type: 'task', ref: 'urn:dec:item:01HX9ABC' }],
    });
    const result = validate(item);
    if (!result.ok) console.error('unexpected media fail:', result.errors);
    expect(result.ok).toBe(true);
    expect(metadata('media')).toEqual({ name: 'media', iri: `${NAMESPACE}Media` });
    expect(schema('media')).toBeTruthy();
  });

  it('rejects a media item with no storage pointer at all', () => {
    const result = validate(baseItem('media', { mime: 'image/png', caption: 'no bytes anywhere' }));
    expect(result.ok).toBe(false);
  });

  it('rejects a media item whose source has no ref', () => {
    const result = validate(baseItem('media', { source: { type: 'blob' } }));
    expect(result.ok).toBe(false);
  });

  it('rejects a non-blob source missing the embeds-entry type field', () => {
    const result = validate(baseItem('media', { source: { ref: 'https://anne.pod/photos/x.jpg' } }));
    expect(result.ok).toBe(false);
  });

  it('accepts non-blob refs — the pointer is any embeds-shaped line', () => {
    const result = validate(baseItem('media', {
      source: { type: 'photo', ref: 'pseudo-pod://anne-device/photos/x.jpg' },
    }));
    expect(result.ok).toBe(true);
  });

  it('tolerates unknown extra fields, like every sibling type', () => {
    const result = validate(baseItem('media', {
      source:      SOURCE,
      futureField: 'alt-text maybe',
      blurhash:    'LEHV6nWB2yk8',
    }));
    expect(result.ok).toBe(true);
  });

  it('rejects writer-asserted dimensions of the wrong shape', () => {
    expect(validate(baseItem('media', { source: SOURCE, width: '800' })).ok).toBe(false);
    expect(validate(baseItem('media', { source: SOURCE, height: 0 })).ok).toBe(false);
  });
});

describe('media × blob-gateway composition — the enriched manifest line slots in as source', () => {
  // Real fitness function: build the line with blob-gateway's own
  // makeManifestLine (packages/blob-gateway/src/ref.js) so a shape
  // change there fails HERE, not in a renderer at runtime.
  const LINE_ARGS = { key: 'bucket-key-9', keyRef: 'circle:gardening', bytes: 54321, mime: 'image/jpeg', width: 800, height: 600 };

  it('an enriched line WITH a thumb validates as media.source', async () => {
    const { makeManifestLine } = await import('../../blob-gateway/src/ref.js');
    const line = makeManifestLine({ ...LINE_ARGS, thumb: 'fp1:sealed-thumb-envelope' });
    expect(line.enc.thumb).toBe('fp1:sealed-thumb-envelope');
    const result = validate(baseItem('media', { source: line, mime: line.enc.mime, width: line.enc.width, height: line.enc.height }));
    expect(result.ok).toBe(true);
  });

  it('an enriched line WITHOUT a thumb (pre-enrichment shape) also validates', async () => {
    const { makeManifestLine } = await import('../../blob-gateway/src/ref.js');
    const line = makeManifestLine({ key: 'bucket-key-9', keyRef: 'circle:gardening', bytes: 54321 });
    expect(line.enc.thumb).toBeUndefined();
    const result = validate(baseItem('media', { source: line }));
    expect(result.ok).toBe(true);
  });
});

describe('offer / request kind enum (2026-05-12 vocab refresh)', () => {
  const SHIPPING_OFFER_KINDS  = ['lend', 'share', 'give', 'sell', 'help', 'other'];
  const SHIPPING_REQUEST_KINDS = ['borrow', 'share', 'receive', 'buy', 'help', 'other'];

  for (const kind of SHIPPING_OFFER_KINDS) {
    it(`offer accepts kind="${kind}"`, () => {
      const result = validate(baseItem('offer', { body: 'something', kind }));
      expect(result.ok).toBe(true);
    });
  }

  for (const kind of SHIPPING_REQUEST_KINDS) {
    it(`request accepts kind="${kind}"`, () => {
      const result = validate(baseItem('request', { body: 'something', kind }));
      expect(result.ok).toBe(true);
    });
  }

  it('offer rejects an unknown kind', () => {
    const result = validate(baseItem('offer', { body: 'x', kind: 'launder' }));
    expect(result.ok).toBe(false);
  });

  it('request rejects an unknown kind', () => {
    const result = validate(baseItem('request', { body: 'x', kind: 'launder' }));
    expect(result.ok).toBe(false);
  });

  it('kind is optional — UI may post under-specified items', () => {
    expect(validate(baseItem('offer',   { body: 'x' })).ok).toBe(true);
    expect(validate(baseItem('request', { body: 'x' })).ok).toBe(true);
  });
});

describe('Legacy vocabulary aliases (2026-05-12 vocab refresh)', () => {
  it('supply-offer routes to offer schema', () => {
    const result = validate(baseItem('supply-offer', { body: 'ladder' }));
    expect(result.ok).toBe(true);
    expect(metadata('supply-offer')?.name).toBe('offer');
  });

  it('demand-offer routes to request schema', () => {
    const result = validate(baseItem('demand-offer', { body: 'drill?' }));
    expect(result.ok).toBe(true);
    expect(metadata('demand-offer')?.name).toBe('request');
  });

  it('lend-request routes to claim schema', () => {
    const result = validate(baseItem('lend-request', { itemRef: 'pseudo-pod://x/y' }));
    expect(result.ok).toBe(true);
    expect(metadata('lend-request')?.name).toBe('claim');
  });

  it('schema() lookup via legacy name returns the canonical schema', () => {
    const direct = schema('offer');
    const viaAlias = schema('supply-offer');
    expect(viaAlias).toBe(direct);
  });
});
