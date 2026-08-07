/**
 * dag-tree reads the item-store CONTAINMENT edge (`containedBy`) — the tree half of the #17 parentTaskId →
 * containment cutover. The legacy `parentTaskId` tree field is retired and is IGNORED (no writer sets it);
 * these cases pin that the tree is built purely from containment.
 */
import { describe, it, expect } from 'vitest';
import { childrenOf, treeOf, ancestorChain, depthOf } from '../src/dag-tree.js';

const P = { id: 'p', text: 'parent' };
const C1 = { id: 'c1', text: 'child 1', containedBy: ['p'] };
const C2 = { id: 'c2', text: 'child 2', containedBy: ['p'] };
const G = { id: 'g', text: 'grandchild', containedBy: ['c1'] };
const all = [P, C1, C2, G];

describe('dag-tree over containment (containedBy)', () => {
  it('childrenOf reads containedBy', () => {
    expect(childrenOf('p', all).map((t) => t.id).sort()).toEqual(['c1', 'c2']);
    expect(childrenOf('c1', all).map((t) => t.id)).toEqual(['g']);
  });

  it('treeOf builds the nested tree from containment', () => {
    const tree = treeOf('p', all);
    expect(tree.id).toBe('p');
    expect(tree.children.map((n) => n.id).sort()).toEqual(['c1', 'c2']);
    const c1 = tree.children.find((n) => n.id === 'c1');
    expect(c1.children.map((n) => n.id)).toEqual(['g']);
  });

  it('ancestorChain + depthOf walk the containment chain', () => {
    expect(ancestorChain('g', all).map((t) => t.id)).toEqual(['p', 'c1', 'g']);
    expect(depthOf('g', all)).toBe(2);
    expect(depthOf('c1', all)).toBe(1);
    expect(depthOf('p', all)).toBe(0);
  });

  it('the legacy parentTaskId field is IGNORED — only containment builds the tree', () => {
    const mixed = [P, { id: 'c', text: 'c', containedBy: ['p'], parentTaskId: 'other' }];
    expect(childrenOf('p', mixed).map((t) => t.id)).toEqual(['c']);
    expect(childrenOf('other', mixed)).toEqual([]);   // parentTaskId no longer forms a tree edge
  });
});
