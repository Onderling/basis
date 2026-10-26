/**
 * A pinboard op that acts on an item — one that takes a groupId / itemId / requestId / postId — must SAY
 * whether it acts on the active circle (`circleScoped: true | false`). The circle scope derives its
 * write/list sets from that flag; an op added without it used to land silently in the wrong store (W1,
 * the announcement that reached nobody). The guard makes the omission a red build, not a walk finding.
 */
import { describe, it, expect } from 'vitest';
import { pinboardManifest } from '@onderling-app/pinboard/manifest';
import { circleScopedOps, SCOPED_WRITE_OPS, SCOPED_LIST_OPS } from '../../src/v2/circlePinboardScope.js';

// Ops that act on an ITEM (a post, a request) or write a text body. Ops that take an explicit, required
// `groupId` (membership, governance, the broadcasts) name their circle themselves — nothing to inject.
const ITEM_PARAMS = new Set(['itemId', 'requestId', 'postId']);

describe('circle scoping is declared on the op', () => {
  it('every pinboard op that names an item or a circle declares circleScoped', () => {
    const silent = (pinboardManifest.operations ?? [])
      .filter((op) => (op.params ?? []).some((p) => ITEM_PARAMS.has(p.name)) || (['add', 'claim', 'remove', 'reassign', 'complete', 'report'].includes(op.verb) && (op.params ?? []).some((p) => p.name === 'text')))
      .filter((op) => typeof op.circleScoped !== 'boolean')
      .map((op) => op.id);
    expect(silent, 'ops acting on an item without saying whether the active circle scopes them').toEqual([]);
  });
  it('the derived sets carry the ops the scope used to list by hand, plus their aliases', () => {
    for (const op of ['postRequest', 'respondToItem', 'cancelRequest', 'markReturned', 'assignLend', 'postAnnouncement']) expect(SCOPED_WRITE_OPS.has(op), op).toBe(true);
    for (const op of ['listOpenRequests', 'listFeed', 'listMyRequests', 'getBulletin']) expect(SCOPED_LIST_OPS.has(op), op).toBe(true);
    expect(SCOPED_WRITE_OPS.has('leaveGroup'), 'an explicit false is not scoped').toBe(false);
  });
  it('is derived: a manifest that declares a new scoped op needs no list edit', () => {
    const { writes, lists } = circleScopedOps({ operations: [
      { id: 'postThing', verb: 'add', circleScoped: true },
      { id: 'listThings', verb: 'list', circleScoped: true },
      { id: 'unrelated', verb: 'add' },
    ] }, { things: 'listThings' });
    expect([...writes]).toEqual(['postThing']);
    expect([...lists].sort()).toEqual(['listThings', 'things']);
  });
});
