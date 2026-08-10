import { describe, it, expect } from 'vitest';
import { AgentIdentity, createSpineAppender, verifySpine, SPINE_STATEMENT_ITEM } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { projectCircleRoster } from '../src/skills/index.js';

// The circle-scoped spine signer fix (principle 5): statements are signed with a PER-CIRCLE identity, carry
// the member ref (webid) as the signed `authorRef`, and the roster projection VERIFIES that binding before
// folding — via the device's own resolver, or the trail's proof-checked circleAddress. Unverifiable → ignored
// (strengthen-only). Legacy statements (author == ref, no authorRef) fold exactly as before.

const CIRCLE = 'circle:c1';

function memStore() {
  let seq = 0; const items = [];
  return {
    items,
    async addItems(parts, ctx = {}) {
      const made = parts.map((p) => ({ id: `it${++seq}`, addedBy: ctx.actor ?? null, ...p }));
      items.push(...made); return made;
    },
    async listOpen(filter = {}) { return items.filter((i) => !filter.type || i.type === filter.type); },
  };
}

const redemption = (webid, at, extra = {}) => ({
  type: 'membership-redemption',
  source: { groupId: CIRCLE, redeemedBy: webid, redeemedAt: at, ...extra },
});

describe('circle-scoped spine signing (signerFor) — append side', () => {
  it('signs with the per-circle identity and carries the signed authorRef binding', async () => {
    const circleId1 = await AgentIdentity.generate(new VaultMemory());
    const store = memStore();
    const emit = createSpineAppender({
      store,
      signerFor: async () => ({ identity: circleId1, ref: 'webid:me' }),
    });
    const stmt = await emit({ kind: 'evict', circleId: CIRCLE, subject: 'webid:mel' });
    expect(stmt.body.author).toBe(circleId1.pubKey);              // signed by the CIRCLE key
    expect(stmt.body.payload.authorRef).toBe('webid:me');         // the ref rides the SIGNED payload
    expect(verifySpine(stmt, { expectedCircleId: CIRCLE }).ok).toBe(true);
  });

  it('the leave guard compares against the REF, not the circle pubKey', async () => {
    const cid = await AgentIdentity.generate(new VaultMemory());
    const store = memStore();
    const emit = createSpineAppender({ store, signerFor: async () => ({ identity: cid, ref: 'webid:me' }) });
    expect(await emit({ kind: 'leave', circleId: CIRCLE, subject: 'webid:someone-else' })).toBeNull();
    const own = await emit({ kind: 'leave', circleId: CIRCLE, subject: 'webid:me' });
    expect(own).not.toBeNull();                                   // self-leave passes in ref space
  });

  it('no per-circle signer resolvable → no statement, no throw (additive degrade)', async () => {
    const store = memStore();
    const emit = createSpineAppender({ store, signerFor: async () => null });
    expect(await emit({ kind: 'join', circleId: CIRCLE, subject: 'webid:me' })).toBeNull();
    expect(store.items).toHaveLength(0);
  });

  it('static-signer mode is byte-identical to before (no authorRef added)', async () => {
    const id = await AgentIdentity.generate(new VaultMemory());
    const store = memStore();
    const emit = createSpineAppender({ store, signer: id });
    const stmt = await emit({ kind: 'join', circleId: CIRCLE, subject: id.pubKey });
    expect(stmt.body.author).toBe(id.pubKey);
    expect(stmt.body.payload).toBeUndefined();                    // legacy shape untouched
  });
});

describe('roster projection — verified author resolution (read side)', () => {
  it('SELF binding: a circle-key evict by this device folds after resolution via circleSignerFor', async () => {
    const myCircleId = await AgentIdentity.generate(new VaultMemory());
    const store = memStore();
    // mel joined via the trail; the founder (webid:me) evicts, signed with the CIRCLE key.
    await store.addItems([redemption('webid:mel', 1000)]);
    const emit = createSpineAppender({ store, signerFor: async () => ({ identity: myCircleId, ref: 'webid:me' }) });
    await emit({ kind: 'evict', circleId: CIRCLE, subject: 'webid:mel' });

    const memberMapList = [{ webid: 'webid:me', role: 'admin' }];  // founder via the back-compat admin row
    const withResolver = await projectCircleRoster({
      store, groupId: CIRCLE, memberMapList,
      circleSignerFor: async () => ({ identity: myCircleId, ref: 'webid:me' }),
    });
    expect(withResolver.map((r) => r.webid)).not.toContain('webid:mel');   // evict folded (binding verified)

    // WITHOUT the resolver the binding is unverifiable → the statement is IGNORED, mel stays (never corrupts).
    const withoutResolver = await projectCircleRoster({ store, groupId: CIRCLE, memberMapList });
    expect(withoutResolver.map((r) => r.webid)).toContain('webid:mel');
  });

  it('TRAIL binding: a joiner\'s circle-key statement resolves via the row\'s proof-checked circleAddress', async () => {
    const melCircleId = await AgentIdentity.generate(new VaultMemory());
    const store = memStore();
    // mel's redemption row carries her circleAddress (== her circle pubKey, recorded proof-checked).
    await store.addItems([redemption('webid:mel', 1000, { circleAddress: melCircleId.pubKey })]);
    const emit = createSpineAppender({ store, signerFor: async () => ({ identity: melCircleId, ref: 'webid:mel' }) });
    await emit({ kind: 'leave', circleId: CIRCLE, subject: 'webid:mel' });

    const roster = await projectCircleRoster({
      store, groupId: CIRCLE, memberMapList: [{ webid: 'webid:admin', role: 'admin' }],
    });
    expect(roster.map((r) => r.webid)).not.toContain('webid:mel');   // self-leave resolved + folded via the trail
  });

  it('a FORGED authorRef (binding not on the trail, not self) is ignored — never trusted', async () => {
    const rogue = await AgentIdentity.generate(new VaultMemory());
    const store = memStore();
    await store.addItems([redemption('webid:mel', 1000)]);
    // A rogue circle key CLAIMS to be the admin and evicts mel; no row and no self-binding backs the claim.
    const emit = createSpineAppender({ store, signerFor: async () => ({ identity: rogue, ref: 'webid:admin' }) });
    await emit({ kind: 'evict', circleId: CIRCLE, subject: 'webid:mel' });

    const roster = await projectCircleRoster({
      store, groupId: CIRCLE, memberMapList: [{ webid: 'webid:admin', role: 'admin' }],
      circleSignerFor: async () => ({ identity: await AgentIdentity.generate(new VaultMemory()), ref: 'webid:admin' }),
    });
    expect(roster.map((r) => r.webid)).toContain('webid:mel');       // forged claim ignored; mel stays
  });

  it('LEGACY statements (author == ref, no authorRef) fold exactly as before', async () => {
    const admin = await AgentIdentity.generate(new VaultMemory());
    const store = memStore();
    await store.addItems([redemption('webid:mel', 1000)]);
    const emit = createSpineAppender({ store, signer: admin });      // static: author IS the ref space
    await emit({ kind: 'evict', circleId: CIRCLE, subject: 'webid:mel' });
    const roster = await projectCircleRoster({
      store, groupId: CIRCLE, memberMapList: [{ webid: admin.pubKey, role: 'admin' }],
    });
    expect(roster.map((r) => r.webid)).not.toContain('webid:mel');
  });
});
