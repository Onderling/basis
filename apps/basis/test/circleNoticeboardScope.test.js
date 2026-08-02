/**
 * Regression: the circle noticeboard leaked other circles' items + showed internal
 * stoop bookkeeping. Two causes, both fixed here:
 *  1. itemCircleId read only TOP-LEVEL circle hints, but stoop nests the scope under
 *     source.targets[{kind:'group',groupId}] (posts) / source.groupId (system items) →
 *     every item looked unscoped → keepForCircle kept everything (cross-circle leak).
 *  2. listOpen returns system items (group-rules/membership-code/membership-redemption)
 *     alongside posts; the prikbord must show only asks/offers.
 */
import { describe, it, expect } from 'vitest';
import { itemCircleId, isInCircle } from '../src/v2/circleScope.js';
import { keepForCircle, isNoticeboardPost } from '../src/v2/circleStoopScope.js';

describe('itemCircleId — nested circle hints', () => {
  it('reads a post scope from source.targets[{kind:group}]', () => {
    const post = { type: 'request', source: { targets: [{ kind: 'group', groupId: 'miep' }] } };
    expect(itemCircleId(post)).toBe('miep');
    expect(isInCircle(post, 'miep')).toBe(true);
    expect(isInCircle(post, 'boi')).toBe(false);
  });
  it('reads a system item scope from source.groupId', () => {
    const rules = { type: 'group-rules', source: { groupId: 'boi' } };
    expect(itemCircleId(rules)).toBe('boi');
  });
  it('top-level hint still wins', () => {
    expect(itemCircleId({ groupId: 'mai', source: { groupId: 'boi' } })).toBe('mai');
  });
  it('truly unscoped → null', () => {
    expect(itemCircleId({ type: 'request', text: 'hi' })).toBe(null);
  });
});

describe('keepForCircle — scopes by nested hint', () => {
  const miepPost = { type: 'request', source: { targets: [{ kind: 'group', groupId: 'miep' }] } };
  const boiPost = { type: 'request', source: { targets: [{ kind: 'group', groupId: 'boi' }] } };
  it('keeps a post for its own circle, drops another circle', () => {
    expect(keepForCircle(miepPost, 'miep')).toBe(true);
    expect(keepForCircle(boiPost, 'miep')).toBe(false);   // was: kept (leak)
  });
  it('keeps a genuinely unscoped item (lenient)', () => {
    expect(keepForCircle({ type: 'request', text: 'seed' }, 'miep')).toBe(true);
  });
});

describe('isNoticeboardPost — hides system items', () => {
  it('keeps request/offer', () => {
    expect(isNoticeboardPost({ type: 'request' })).toBe(true);
    expect(isNoticeboardPost({ type: 'offer' })).toBe(true);
  });
  it('drops rules / membership lifecycle', () => {
    expect(isNoticeboardPost({ type: 'group-rules' })).toBe(false);
    expect(isNoticeboardPost({ type: 'membership-code' })).toBe(false);
    expect(isNoticeboardPost({ type: 'membership-redemption' })).toBe(false);
  });
  // The local-first substrate flattens every stoop item to type:'post' — the semantic
  // type is gone, but source shape survives. Recognise system items by source.
  it('drops substrate-collapsed (type:post) system items by source shape', () => {
    expect(isNoticeboardPost({ type: 'post', text: 'Miep', source: { groupId: 'miep', rules: { version: 1 } } })).toBe(false);
    expect(isNoticeboardPost({ type: 'post', text: 'Membership code for miep', source: { groupId: 'miep', code: 'hL-jQbLz', issuedBy: 'x' } })).toBe(false);
    expect(isNoticeboardPost({ type: 'post', source: { groupId: 'miep', redeemedBy: 'x' } })).toBe(false);
  });
  it('keeps a real post that happens to be type:post', () => {
    expect(isNoticeboardPost({ type: 'post', text: 'Anne needs help moving', source: { targets: [{ kind: 'group', groupId: 'miep' }] } })).toBe(true);
  });

  // A circle CHAT line is mirrored into the same itemStore so the conversation survives a
  // reload (stoop `broadcastKringMessage` / `ingestKringMessage`). It is not a noticeboard
  // post — but it was rendered as one, with a "Withdraw" action when it was yours.
  describe('kring chat lines are not noticeboard posts', () => {
    const chatItem = (over = {}) => ({
      type: 'kring-chat-message',
      text: 'zie ik je zaterdag?',
      source: { circleId: 'miep', msgId: 'kring-miep-1735-1', ts: 1735_000_000_000, fromActor: 'webid:anne' },
      ...over,
    });
    it('drops a chat item by type', () => {
      expect(isNoticeboardPost(chatItem())).toBe(false);
    });
    it('drops it on the LIVE path too, where adaptStoopReply has flattened it to type:post', () => {
      expect(isNoticeboardPost(chatItem({ type: 'post' }))).toBe(false);
    });
    it('a chat line carries no circle hint, so it leaked onto EVERY circle unfiltered', () => {
      // Documents why the filter has to be the type/source gate rather than the circle
      // scope: keepForCircle is lenient, and source.circleId is not a hint it reads.
      expect(keepForCircle(chatItem({ type: 'post' }), 'some-other-circle')).toBe(true);
    });
  });
});
