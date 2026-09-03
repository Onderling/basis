/**
 * One post, one row — even when the same post lands twice at once.
 *
 * The stored-row check and the write are two steps, so two ingests of the same post that overlap both
 * read a store without it and both write. That became reachable when the post carry moved onto the
 * circle store: a re-push on circle-open lands the same snapshot again, a beat behind the first.
 * Seen on the walk — the web board showed every post twice, with ULIDs one apart.
 */
import { describe, it, expect, vi } from 'vitest';
import { buildSkills } from '../src/skills/index.js';

function ingestWith() {
  const items = [];
  const store = {
    listOpen: async () => items.slice(),
    addItems: async (drafts) => {
      // A real store write is not instant; the race only shows when it isn't.
      await new Promise((r) => setTimeout(r, 5));
      const rows = drafts.map((d, i) => ({ id: `id-${items.length + i}`, addedAt: Date.now(), ...d }));
      items.push(...rows);
      return rows;
    },
  };
  const skills = buildSkills({
    store,
    offeringMatch: { broadcast: vi.fn(async () => ({ claims: [] })), addPeer: vi.fn() },
    notifier: null, reveals: null, members: null, muted: new Set(),
    localActor: 'urn:me', groupId: 'g1', chat: null, metrics: null, bundle: {},
  });
  const skill = skills.find((s) => s.id === 'ingestRemotePost');
  const payload = { requestId: 'req-1', text: 'Wie heeft een boormachine?', type: 'request', kind: 'borrow', from: 'urn:them' };
  return { items, call: () => skill.handler({ parts: [{ type: 'DataPart', data: { payload } }], from: 'urn:them' }) };
}

describe('ingestRemotePost', () => {
  it('writes once when the same post lands twice in a row', async () => {
    const { items, call } = ingestWith();
    const a = await call();
    const b = await call();
    expect(a.ok).toBe(true);
    expect(b).toEqual({ deduped: true });
    expect(items).toHaveLength(1);
  });

  it('writes once when the two landings OVERLAP — the case the walk found', async () => {
    const { items, call } = ingestWith();
    const [a, b] = await Promise.all([call(), call()]);
    expect(items, 'one post must not become two rows').toHaveLength(1);
    expect([a, b].filter((r) => r?.ok === true)).toHaveLength(1);
    expect([a, b].filter((r) => r?.deduped === true)).toHaveLength(1);
  });
});
