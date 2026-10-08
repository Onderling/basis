import { describe, it, expect } from 'vitest';
import { setOwnedNode, ownedNodesOf, addPendingRevokes, clearPendingRevoke, pendingRevokesOf } from '../index.js';

const A = 'A'.repeat(43); const B = 'B'.repeat(43); const BOT = 'K'.repeat(43);
const props = () => setOwnedNode(setOwnedNode({}, { address: A, claimedAt: '2026-10-09T00:00:00Z' }), { address: B, claimedAt: '2026-10-09T00:00:00Z', label: 'tablet' });

describe('the revokes still owed to a node the person owns', () => {
  it('a key owed to every node, kept on each node\'s record; cleared one node at a time; the record otherwise unchanged', () => {
    let p = addPendingRevokes(props(), [BOT]);
    expect(pendingRevokesOf({ properties: p })).toEqual([{ node: A, key: BOT }, { node: B, key: BOT }]);
    p = addPendingRevokes(p, [BOT]);   // owed once, however often it is asked
    expect(pendingRevokesOf({ properties: p })).toHaveLength(2);
    p = clearPendingRevoke(p, A, BOT);
    expect(pendingRevokesOf({ properties: p })).toEqual([{ node: B, key: BOT }]);
    expect(ownedNodesOf({ properties: p })[B].label).toBe('tablet');
    // a re-claim of the node keeps what it is owed
    p = setOwnedNode(p, { address: B, claimedAt: '2026-10-10T00:00:00Z' });
    expect(pendingRevokesOf({ properties: p })).toEqual([{ node: B, key: BOT }]);
    expect(pendingRevokesOf({ properties: clearPendingRevoke(p, B, BOT) })).toEqual([]);
    expect(pendingRevokesOf({ properties: addPendingRevokes({}, [BOT]) }), 'no nodes, nothing owed').toEqual([]);
  });
});
