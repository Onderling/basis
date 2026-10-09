/**
 * A created circle is on the restore list — even when the agents store did not answer at create time
 * (walk 2026-10-09: the record's write sat in the create's wait, and a failure there lost it). The heal runs at
 * every boot and writes what is missing, bounded per write.
 */
import { describe, it, expect, vi } from 'vitest';
import { healRestoreList } from '../../src/v2/restoreListHeal.js';

const addressFor = (id) => `addr-${id}`;

describe('healRestoreList', () => {
  it('writes the record for a circle missing from the restore list, with its derived address', async () => {
    const write = vi.fn(async () => ({ ok: true }));
    const r = await healRestoreList({ circleIds: async () => ['c1', 'c2'], memberships: async () => ({ c1: { address: 'addr-c1' } }), addressFor, write });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith('c2', 'addr-c2');
    expect(r).toEqual({ written: ['c2'], failed: [] });
  });

  it('a dead agents store: each write is bounded, the circle is reported as still missing, nothing hangs', async () => {
    const write = vi.fn(() => new Promise(() => {}));
    const log = vi.fn();
    const t0 = Date.now();
    const r = await healRestoreList({ circleIds: async () => ['c1'], memberships: async () => ({}), addressFor, write, boundMs: 30, log });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(r).toEqual({ written: [], failed: ['c1'] });
    expect(log).toHaveBeenCalled();
  });

  it('…and the NEXT boot, with the store back, puts it on the list', async () => {
    const list = {};
    const write = vi.fn(async (id, address) => { list[id] = { address }; });
    await healRestoreList({ circleIds: async () => ['c1'], memberships: async () => ({ ...list }), addressFor, write });
    expect(list.c1).toEqual({ address: 'addr-c1' });
  });

  it('touches nothing already on the list, and gives up quietly when the list cannot be read', async () => {
    const write = vi.fn();
    await healRestoreList({ circleIds: async () => ['c1'], memberships: async () => ({ c1: { handle: 'bea' } }), addressFor, write });
    await healRestoreList({ circleIds: async () => ['c1'], memberships: async () => { throw new Error('down'); }, addressFor, write });
    expect(write).not.toHaveBeenCalled();
  });
});
