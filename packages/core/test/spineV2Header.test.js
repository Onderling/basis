/**
 * THE STATEMENT FORMAT v2: the chain hash and the signature are both over ONE HEADER that commits to the payload.
 *
 *   header = { v: 'onderling/spine.v2', kind, circleId, subject, authorRef, author, parentHash, deps, payloadDigest }
 *
 * in one canonical form, sorted at every depth. What it gives: a tombstone (the header and its signature, the payload
 * gone) proves itself, so it can be sent on and a planted one fails; one statement has ONE hash, whatever order its
 * payload's nested keys were written in; the payload and the authorRef cannot be changed without breaking the check.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';
import { signSpine, verifySpine, SPINE_STMT_VERSION, canonicalDeep } from '../src/security/spineStatement.js';

const CID = 'circle-v2';
const me = () => AgentIdentity.generate(new VaultMemory());
const tombstoneOf = (st) => {
  const { payload, ...head } = st.body;
  return { tombstone: true, body: head, sig: st.sig };
};

describe('spine v2: one header, hashed and signed', () => {
  it('the version is v2 and the body carries the header fields (authorRef from the payload, the payload digest)', async () => {
    const a = await me();
    const st = signSpine(a, { kind: 'member-props', circleId: CID, subject: a.pubKey, payload: { authorRef: 'ref-a', displayName: 'Ann' } });
    expect(SPINE_STMT_VERSION).toBe('onderling/spine.v2');
    expect(st.body).toMatchObject({ v: SPINE_STMT_VERSION, authorRef: 'ref-a', author: a.pubKey, parentHash: null });
    expect(typeof st.body.payloadDigest).toBe('string');
    expect(verifySpine(st, { expectedCircleId: CID }).ok).toBe(true);
  });

  it('a TOMBSTONE (header + signature, no payload) proves itself', async () => {
    const a = await me();
    const st = signSpine(a, { kind: 'member-props', circleId: CID, subject: a.pubKey, payload: { authorRef: 'ref-a', displayName: 'Ann' } });
    const r = verifySpine(tombstoneOf(st), { expectedCircleId: CID });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r.body.authorRef).toBe('ref-a');
  });

  it('a PLANTED tombstone fails: any header field changed, or a header nobody signed', async () => {
    const a = await me();
    const st = signSpine(a, { kind: 'member-props', circleId: CID, subject: a.pubKey, payload: { authorRef: 'ref-a', displayName: 'Ann' } });
    for (const change of [{ kind: 'role' }, { authorRef: 'MALLORY' }, { subject: 'MALLORY' }, { parentHash: 'f'.repeat(64) }, { payloadDigest: '0'.repeat(64) }]) {
      const t = tombstoneOf(st);
      t.body = { ...t.body, ...change };
      expect(verifySpine(t).ok, JSON.stringify(change)).toBe(false);
    }
  });

  it('a statement that is not marked a tombstone must carry its payload (dropping it is refused)', async () => {
    const a = await me();
    const st = signSpine(a, { kind: 'member-props', circleId: CID, subject: a.pubKey, payload: { authorRef: 'ref-a', displayName: 'Ann' } });
    const { payload, ...head } = st.body;
    expect(verifySpine({ body: head, sig: st.sig }).ok).toBe(false);
  });

  it('the payload and the authorRef cannot be changed: the digest no longer matches, or the header no longer agrees', async () => {
    const a = await me();
    const st = signSpine(a, { kind: 'member-props', circleId: CID, subject: a.pubKey, payload: { authorRef: 'ref-a', displayName: 'Ann' } });
    expect(verifySpine({ ...st, body: { ...st.body, payload: { ...st.body.payload, displayName: 'Mallory' } } }).ok).toBe(false);
    expect(verifySpine({ ...st, body: { ...st.body, payload: { ...st.body.payload, authorRef: 'ref-b' } } }).ok).toBe(false);
  });

  it('ONE statement has ONE hash: nested payload keys in any order canonicalise the same', async () => {
    expect(canonicalDeep({ b: { y: 1, x: [{ q: 2, p: 1 }] }, a: 0 })).toBe(canonicalDeep({ a: 0, b: { x: [{ p: 1, q: 2 }], y: 1 } }));
    const a = await me();
    const one = signSpine(a, { kind: 'member-props', circleId: CID, subject: a.pubKey, payload: { authorRef: 'r', props: { b: 2, a: 1 } } });
    const two = signSpine(a, { kind: 'member-props', circleId: CID, subject: a.pubKey, payload: { props: { a: 1, b: 2 }, authorRef: 'r' } });
    expect(one.body.hash).toBe(two.body.hash);
  });

  it('a different frontier off the same parent is a different hash (a fork stays detectable)', async () => {
    const a = await me();
    const x = signSpine(a, { kind: 'vote', circleId: CID, subject: 'p', payload: { authorRef: 'r' }, deps: ['h1'] });
    const y = signSpine(a, { kind: 'vote', circleId: CID, subject: 'p', payload: { authorRef: 'r' }, deps: ['h2'] });
    expect(x.body.hash).not.toBe(y.body.hash);
    expect(verifySpine(x).ok && verifySpine(y).ok).toBe(true);
  });
});
