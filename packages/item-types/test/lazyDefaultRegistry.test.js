/**
 * The default registry is built on first use, not at import.
 *
 * Measured on a phone (2026-10-23, module timing): `@onderling/item-types` was the one large module of ours on the
 * path to the first paint — 77 ms, building the default registry (a new Ajv + formats + the canonical set) the moment
 * the package was imported. The first call builds it fully before answering, so no half-built registry is observable.
 */
import { describe, it, expect } from 'vitest';

describe('the default registry', () => {
  it('is not built by importing the package, and is built fully by the first call', async () => {
    const itemTypes = await import('../index.js');
    expect(itemTypes._defaultRegistryBuilt()).toBe(false);
    const names = itemTypes.list();
    expect(itemTypes._defaultRegistryBuilt()).toBe(true);
    expect(names).toEqual(Object.keys(itemTypes.CANONICAL_TYPES).sort());
    expect(itemTypes.validate({ type: 'nope' }).ok).toBe(false);
  });
});
