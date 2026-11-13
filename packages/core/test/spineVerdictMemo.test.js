/**
 * A STATEMENT CHECKED ONCE IS NOT CHECKED AGAIN. On the Samsung a cold start ran verifySpine 554 times over 71 distinct
 * statements (each read of a lane re-checks every stored statement), and the circle-link proof 920 times over 23
 * addresses. The signature itself was already remembered; what repeated was the canonical form and the hashes around
 * it, ~2.7 ms each there. A verdict memo remembers that EXACTLY this statement (its full content, compared as bytes)
 * checked out, so a second read of the same lane does none of that work. Counted, not timed: how often the signature
 * step is reached.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';
import { signSpine, verifySpine } from '../src/security/spineStatement.js';
import { createVerdictMemo, exactVerdictKey } from '../src/security/signatureMemo.js';
import { signCircleLink, verifyCircleLink } from '../src/identity/circleLink.js';

const CID = 'circle-memo';
const counting = () => {
  const calls = { n: 0 };
  const verify = (m, s, k) => { calls.n += 1; return AgentIdentity.verify(m, s, k); };
  return { calls, verify };
};

describe('the verdict memo over verifySpine', () => {
  it('ten reads of one statement (each a fresh copy, as a log read hands out) reach the signature check once', async () => {
    const a = await AgentIdentity.generate(new VaultMemory());
    const st = signSpine(a, { kind: 'member-props', circleId: CID, subject: a.pubKey, payload: { authorRef: 'ref-a', displayName: 'Ann' } });
    const memo = createVerdictMemo();
    const { calls, verify } = counting();
    for (let i = 0; i < 10; i++) {
      const r = verifySpine(structuredClone(st), { expectedCircleId: CID, verifySignature: verify, verdictMemo: memo });
      expect(r.ok).toBe(true);
    }
    expect(calls.n).toBe(1);
  });

  it('a copy changed anywhere is checked again, and refused', async () => {
    const a = await AgentIdentity.generate(new VaultMemory());
    const st = signSpine(a, { kind: 'member-props', circleId: CID, subject: a.pubKey, payload: { authorRef: 'ref-a', displayName: 'Ann' } });
    const memo = createVerdictMemo();
    const { calls, verify } = counting();
    expect(verifySpine(st, { verifySignature: verify, verdictMemo: memo }).ok).toBe(true);
    const bad = structuredClone(st); bad.body.payload.displayName = 'Mallory';
    expect(verifySpine(bad, { verifySignature: verify, verdictMemo: memo }).ok).toBe(false);   // the digest no longer matches
    const badSig = structuredClone(st); badSig.sig = st.sig.slice(0, -4) + (st.sig.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    expect(verifySpine(badSig, { verifySignature: verify, verdictMemo: memo }).ok).toBe(false);
    expect(calls.n).toBe(2);   // the good one once, the bad signature once; the bad payload never got that far
  });

  it('a refusal is never remembered: the same bad statement is checked every time', async () => {
    const a = await AgentIdentity.generate(new VaultMemory());
    const st = signSpine(a, { kind: 'member-props', circleId: CID, subject: a.pubKey, payload: { authorRef: 'ref-a' } });
    const bad = structuredClone(st); bad.sig = st.sig.slice(0, -4) + (st.sig.endsWith('AAAA') ? 'BBBB' : 'AAAA');
    const memo = createVerdictMemo();
    const { calls, verify } = counting();
    for (let i = 0; i < 3; i++) expect(verifySpine(bad, { verifySignature: verify, verdictMemo: memo }).ok).toBe(false);
    expect(calls.n).toBe(3);
    expect(memo.size).toBe(0);
  });

  it('what the caller asked is part of the verdict: a statement good for its circle is still refused for another', async () => {
    const a = await AgentIdentity.generate(new VaultMemory());
    const st = signSpine(a, { kind: 'leave', circleId: CID, subject: a.pubKey });
    const memo = createVerdictMemo();
    expect(verifySpine(st, { expectedCircleId: CID, expectedKind: 'leave', verdictMemo: memo }).ok).toBe(true);
    expect(verifySpine(st, { expectedCircleId: 'other', verdictMemo: memo })).toMatchObject({ ok: false, reason: 'circle mismatch' });
    expect(verifySpine(st, { expectedKind: 'join', verdictMemo: memo })).toMatchObject({ ok: false, reason: 'kind mismatch' });
  });

  it('a tombstone and the full statement are different verdicts', async () => {
    const a = await AgentIdentity.generate(new VaultMemory());
    const st = signSpine(a, { kind: 'member-props', circleId: CID, subject: a.pubKey, payload: { authorRef: 'ref-a', displayName: 'Ann' } });
    const memo = createVerdictMemo();
    expect(verifySpine(st, { verdictMemo: memo }).ok).toBe(true);
    // the full body marked as a tombstone keeps more than its authorRef: refused, whatever the memo holds for the full one
    expect(verifySpine({ ...st, tombstone: true }, { verdictMemo: memo })).toMatchObject({ ok: false, reason: 'a tombstone keeps its authorRef only' });
  });

  it('the answer hands back the statement it was asked about, never a remembered copy', async () => {
    const a = await AgentIdentity.generate(new VaultMemory());
    const st = signSpine(a, { kind: 'member-props', circleId: CID, subject: a.pubKey, payload: { authorRef: 'ref-a' } });
    const memo = createVerdictMemo();
    verifySpine(st, { verdictMemo: memo });
    const copy = structuredClone(st);
    expect(verifySpine(copy, { verdictMemo: memo }).body).toBe(copy.body);
  });

  it('by default the process memo is used, unless the caller brings its own signature check', async () => {
    const a = await AgentIdentity.generate(new VaultMemory());
    const st = signSpine(a, { kind: 'member-props', circleId: CID, subject: a.pubKey, payload: { authorRef: 'ref-default' } });
    expect(verifySpine(st).ok).toBe(true);
    // a caller's own check is always reached: a remembered verdict never stands in for the caller's rule
    const { calls, verify } = counting();
    expect(verifySpine(structuredClone(st), { verifySignature: verify }).ok).toBe(true);
    expect(calls.n).toBe(1);
  });

  it('a value JSON cannot tell apart is never answered from memory: a NaN where the valid statement holds null is refused', async () => {
    const a = await AgentIdentity.generate(new VaultMemory());
    const st = signSpine(a, { kind: 'leave', circleId: CID, subject: a.pubKey });
    const memo = createVerdictMemo();
    expect(verifySpine(st, { verdictMemo: memo }).ok).toBe(true);
    const odd = structuredClone(st); odd.body.parentHash = Number.NaN;   // JSON writes it as null, the valid value
    expect(verifySpine(odd, { verdictMemo: memo })).toMatchObject({ ok: false });
    expect(exactVerdictKey({ a: Number.NaN })).toBeNull();
    expect(exactVerdictKey({ d: new Date(0) })).toBeNull();
    expect(exactVerdictKey({ xs: [1, undefined] })).toBeNull();
    expect(exactVerdictKey({ f: () => 1 })).toBeNull();
    expect(exactVerdictKey({ s: Symbol('x') })).toBeNull();
    expect(exactVerdictKey({ a: 1, b: 'x', c: null })).toBe('{"a":1,"b":"x","c":null}');
  });

  it('the bound holds: least recently used out first', async () => {
    const a = await AgentIdentity.generate(new VaultMemory());
    const sts = [0, 1, 2].map((i) => signSpine(a, { kind: 'member-props', circleId: CID, subject: `s-${i}`, payload: { authorRef: 'r' } }));
    const one = JSON.stringify(sts[0]).length * 2 + 200;
    const memo = createVerdictMemo({ maxBytes: one * 2 });
    for (const st of sts) verifySpine(st, { verdictMemo: memo });
    expect(memo.size).toBe(2);
  });
});

describe('the verdict memo over the circle-link proof', () => {
  it('ten checks of one proof reach the signature check once; another address or proof is checked again', async () => {
    const a = await AgentIdentity.generate(new VaultMemory());
    // the proof is signed by the circle address's own key, so the address IS the signer's public key
    const proof = signCircleLink(a, CID, a.pubKey);
    const memo = createVerdictMemo();
    const { calls, verify } = counting();
    for (let i = 0; i < 10; i++) expect(verifyCircleLink({ groupId: CID, address: a.pubKey, proof, verifySignature: verify, verdictMemo: memo })).toBe(true);
    expect(calls.n).toBe(1);
    expect(verifyCircleLink({ groupId: 'other', address: a.pubKey, proof, verifySignature: verify, verdictMemo: memo })).toBe(false);
    expect(calls.n).toBe(2);
    // never coerced: a group id that is not the string asked before is keyed apart, so the memo answers exactly as the
    // full check does (which reads the id through String() in the signed message)
    const full = verifyCircleLink({ groupId: [CID], address: a.pubKey, proof, verifySignature: verify });
    expect(verifyCircleLink({ groupId: [CID], address: a.pubKey, proof, verifySignature: verify, verdictMemo: memo })).toBe(full);
    expect(memo.size).toBe(full ? 2 : 1);
  });
});
