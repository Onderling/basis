/**
 * The caching data source counts its changes. A store above it keeps what it read in memory and needs to know when
 * something beneath it changed — any write, delete, read-through fill or pull, whoever made it.
 */
import { describe, it, expect } from 'vitest';
import { CachingDataSource } from '../src/CachingDataSource.js';

describe('CachingDataSource.revision', () => {
  it('moves by one on every write and delete, with or without a persistence callback', async () => {
    for (const onLocalChange of [undefined, () => {}]) {
      const ds = new CachingDataSource({ onLocalChange });
      const r0 = ds.revision;
      expect(typeof r0).toBe('number');
      await ds.write('mem://a', '1');
      expect(ds.revision).toBe(r0 + 1);
      await ds.delete('mem://a');
      expect(ds.revision).toBe(r0 + 2);
    }
  });

  it('a read that only finds what it holds does not move it; a read-through fill from the inner source does', async () => {
    const inner = { async read(p) { return p === 'mem://far' ? 'x' : null; }, async write() {}, async delete() {}, async list() { return []; } };
    const ds = new CachingDataSource({ inner });
    await ds.write('mem://near', '1');
    const r = ds.revision;
    await ds.read('mem://near');
    expect(ds.revision).toBe(r);
    await ds.read('mem://far');
    expect(ds.revision).toBe(r + 1);
  });
});
