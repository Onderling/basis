/**
 * DOES A LATE JOINER FOLD THE SAME ROSTER WHEN IT LACKS A COMPACTED STATEMENT?
 *
 * The fold orders statements by causal depth: a statement's depth is 1 + the deepest of its parents (its author's own
 * `parentHash` and the `deps` it had seen), and a parent that is not present is SKIPPED. A device that was in the
 * circle holds a compacted statement as a tombstone, which keeps the edge; a device that joins later cannot accept a
 * tombstone (it has no signature) and so lacks that parent. The question: can the two then order two acts differently
 * and fold different rosters?
 *
 * The case, built to sit exactly on the boundary: the founder admits bram and alex and makes alex admin. Bram sets
 * his name twice (the first statement dies and is compacted). Alex, having SEEN bram's newest name, evicts bram.
 * On a device that holds the tombstone, bram's newest name is one deeper, so alex's evict folds after alex's
 * promotion; on a device without it, the evict sits at the promotion's own depth.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, signSpine, foldRoster } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';

const CID = 'circle-late-joiner-order';
/** A rail-shaped body, as `readVerifiedBodies` hands the fold: author = the member ref, authorKey = the signing key. */
const asRead = (st) => ({ ...st.body, author: st.body.payload.authorRef, authorKey: st.body.author });
/** A tombstone as the rail hands it: the chain fields, the authorRef only. */
const asTombstone = (st) => ({ ...asRead(st), payload: { authorRef: st.body.payload.authorRef }, tombstone: true });

// THE FINDING (2026-11-12): it does NOT. The devices that were there fold bram evicted; the late joiner folds bram
// still in. This test pins that, as the reason compaction is paused (`COMPACT_SUPERSEDED_PROPS` in membershipRail.js).
// When a tombstone can prove itself (the statement format whose signature covers a header the tombstone keeps), the
// late joiner accepts the tombstone, and this test is rewritten to expect the SAME roster.
describe('a late joiner without a compacted statement folds a DIFFERENT roster (why compaction is paused)', () => {
  it('the evict lands differently with and without the tombstoned parent', async () => {
    const [founder, bram, alex] = await Promise.all([1, 2, 3].map(() => AgentIdentity.generate(new VaultMemory())));
    const s = (who, kind, subject, payload, o = {}) => signSpine(who, { kind, circleId: CID, subject, payload: { authorRef: who.pubKey, ...payload }, ...o });

    const joinBram = s(founder, 'join', bram.pubKey, { rulesAccepted: 'v1' });
    const joinAlex = s(founder, 'join', alex.pubKey, { rulesAccepted: 'v1' }, { parent: joinBram.body.hash });
    const promote = s(founder, 'role', alex.pubKey, { role: 'admin' }, { parent: joinAlex.body.hash });
    const name1 = s(bram, 'member-props', bram.pubKey, { displayName: 'Bram Een' }, { deps: [joinBram.body.hash] });
    const name2 = s(bram, 'member-props', bram.pubKey, { displayName: 'Bram Twee' }, { parent: name1.body.hash, deps: [joinBram.body.hash] });
    // alex has seen bram's newest name (and, through it, the join); alex's own promotion is NOT in its deps
    const evict = s(alex, 'evict', bram.pubKey, {}, { deps: [name2.body.hash] });

    const founders = [founder.pubKey];
    const live = [joinBram, joinAlex, promote, name1, name2, evict].map(asRead);
    const full = foldRoster(live, { founders });
    expect(full.superseded, 'the first name is dead, so a device compacts it').toContain(name1.body.hash);

    // a device that was there: the dead statement is a tombstone (the edge stays)
    const withTombstone = foldRoster([joinBram, joinAlex, promote].map(asRead).concat([asTombstone(name1)], [name2, evict].map(asRead)), { founders });
    // a device that joined later: it never accepted the tombstone (no signature), so the parent is missing
    const lateJoiner = foldRoster([joinBram, joinAlex, promote, name2, evict].map(asRead), { founders });

    const view = (f) => ({ members: f.members, admins: f.admins });
    expect(view(withTombstone), 'the tombstone keeps the fold where it was').toEqual(view(full));
    expect(full.members, 'with every statement, alex evicts bram after alex was made admin').not.toContain(bram.pubKey);
    expect(lateJoiner.members, 'without the compacted parent, the evict sits at the promotion\'s depth and does not land').toContain(bram.pubKey);
    expect(view(lateJoiner)).not.toEqual(view(withTombstone));
  });
});
