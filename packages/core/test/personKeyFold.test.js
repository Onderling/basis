/**
 * The person-key head: a member's CURRENT rotating signing key, per circle, folded identically on every replica.
 * The rail's verifier has already refused what does not bind by root reveal; this fold only decides which of a
 * member's own announcements is current.
 */
import { describe, it, expect } from 'vitest';
import {
  foldPersonKeys, personKeyFacts, isSelfPersonKeyStatement, PERSON_KEY_KIND,
  CEREMONY_KINDS, isCeremonyKind, ceremonyRevealFacts, ADDRESS_REVOKE_KIND,
} from '../src/index.js';

const pk = (subject, version, pubKey, over = {}) => ({ kind: PERSON_KEY_KIND, subject, author: subject, payload: { version, pubKey }, ...over });

describe('foldPersonKeys — the highest version is current', () => {
  it('folds one announcement per member, the highest version winning whatever the order', () => {
    const m = foldPersonKeys([pk('w:ada', 1, 'A1'), pk('w:bob', 3, 'B3'), pk('w:ada', 2, 'A2'), pk('w:bob', 2, 'B2')]);
    expect(m.get('w:ada')).toMatchObject({ version: 2, pubKey: 'A2' });
    expect(m.get('w:bob')).toMatchObject({ version: 3, pubKey: 'B3' });
    expect(foldPersonKeys([pk('w:ada', 2, 'A2'), pk('w:ada', 1, 'A1')]).get('w:ada').pubKey, 'order-independent').toBe('A2');
  });

  it('SELF-SUBJECT: a statement about someone else is ignored, whoever authored it', () => {
    const m = foldPersonKeys([pk('w:ada', 5, 'FORGED', { author: 'w:mallory' }), pk('w:ada', 1, 'A1')]);
    expect(m.get('w:ada')).toMatchObject({ version: 1, pubKey: 'A1' });
    expect(isSelfPersonKeyStatement(pk('w:ada', 5, 'X', { author: 'w:mallory' }))).toBe(false);
  });

  it('two announcements at ONE version resolve the same way on every replica (smaller hash wins)', () => {
    const a = pk('w:ada', 2, 'A2-a', { hash: 'bbb' });
    const b = pk('w:ada', 2, 'A2-b', { hash: 'aaa' });
    expect(foldPersonKeys([a, b]).get('w:ada').pubKey).toBe('A2-b');
    expect(foldPersonKeys([b, a]).get('w:ada').pubKey).toBe('A2-b');
    // without hashes the key itself breaks the tie, still deterministically
    expect(foldPersonKeys([pk('w:ada', 2, 'Z'), pk('w:ada', 2, 'M')]).get('w:ada').pubKey).toBe('M');
  });

  it('junk is skipped, never thrown on', () => {
    expect(() => foldPersonKeys(null)).not.toThrow();
    const m = foldPersonKeys([null, {}, { kind: 'join', subject: 'w:ada', author: 'w:ada' },
      pk('w:ada', 0, 'A0'), pk('w:ada', 1.5, 'A15'), pk('w:ada', 1, ''), pk('w:ada', '2', 'A2'), pk('w:ada', 1, 'A1')]);
    expect(m.get('w:ada')).toMatchObject({ version: 1, pubKey: 'A1' });
  });
});

describe('the facts a reveal covers, and the ceremony kinds — declared once', () => {
  it('personKeyFacts binds version AND key; malformed → null', () => {
    expect(personKeyFacts({ version: 2, pubKey: 'K' })).toBe('person-key|2|K');
    for (const bad of [null, {}, { version: 2 }, { pubKey: 'K' }, { version: 0, pubKey: 'K' }, { version: '2', pubKey: 'K' }]) expect(personKeyFacts(bad)).toBe(null);
  });
  it('address-revoke and person-key are the ceremony kinds; only person-key carries facts', () => {
    expect([...CEREMONY_KINDS].sort()).toEqual([ADDRESS_REVOKE_KIND, PERSON_KEY_KIND].sort());
    expect(isCeremonyKind('join')).toBe(false);
    expect(ceremonyRevealFacts({ kind: ADDRESS_REVOKE_KIND, payload: { version: 2, pubKey: 'K' } })).toBe(null);
    expect(ceremonyRevealFacts({ kind: PERSON_KEY_KIND, payload: { version: 2, pubKey: 'K' } })).toBe('person-key|2|K');
  });
});

describe('the first key rides the join or the create (option A, 2026-09-16)', () => {
  const join = (subject, pk, over = {}) => ({ kind: 'join', subject, author: subject, payload: { redemptionRef: 'r', ...(pk ? { personKey: pk } : {}) }, ...over });
  it('a join-carried key lands for its SUBJECT — self-authored or admin-authored', () => {
    const m = foldPersonKeys([join('w:ada', { version: 1, pubKey: 'A1' }), join('w:bob', { version: 1, pubKey: 'B1' }, { author: 'w:admin' })]);
    expect(m.get('w:ada')).toMatchObject({ version: 1, pubKey: 'A1' });
    expect(m.get('w:bob')).toMatchObject({ version: 1, pubKey: 'B1' });
  });
  it('a create carries the creator\'s key; a join with no key sets nothing', () => {
    const m = foldPersonKeys([{ kind: 'create', subject: 'w:ada', author: 'w:ada', payload: { personKey: { version: 1, pubKey: 'A1' } } }, join('w:bob', null)]);
    expect(m.get('w:ada')).toMatchObject({ version: 1, pubKey: 'A1' });
    expect(m.has('w:bob')).toBe(false);
  });
  it('a root-revealed statement OUTRANKS a join-carried key at the same version; a higher version wins regardless', () => {
    const revealed = pk('w:ada', 1, 'A1-revealed', { hash: 'zzz' });
    expect(foldPersonKeys([join('w:ada', { version: 1, pubKey: 'A1-join' }, { hash: 'aaa' }), revealed]).get('w:ada').pubKey).toBe('A1-revealed');
    expect(foldPersonKeys([revealed, join('w:ada', { version: 1, pubKey: 'A1-join' }, { hash: 'aaa' })]).get('w:ada').pubKey).toBe('A1-revealed');
    expect(foldPersonKeys([revealed, join('w:ada', { version: 2, pubKey: 'A2-rejoin' })]).get('w:ada').pubKey, 'a later join carrying v2 (after a rotation) wins by version').toBe('A2-rejoin');
  });
  it('a malformed join-carried key is ignored', () => {
    expect(foldPersonKeys([join('w:ada', { version: 0, pubKey: 'x' }), join('w:ada', { pubKey: 'x' })]).size).toBe(0);
  });
});
