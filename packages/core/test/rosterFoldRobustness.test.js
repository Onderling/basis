/**
 * rosterFold ROBUSTNESS — the pre-rail tests the 2026-08-10 #33 deps-DAG review named as gaps (see
 * plans/REVIEW-33-deps-dag.md). The fold's comments CLAIM these properties; nothing pinned them:
 *   1. a DANGLING dep (a forged / not-yet-seen hash) never breaks determinism or drops the statement;
 *   2. DUPLICATE statements fold idempotently (redelivery is free);
 *   3. a GAP that fills later re-folds to the complete answer, and the gapped fold is DENY-FAVORING —
 *      omission can hide a re-admission (deny) but never an eviction (admit) — the "lying by omission is
 *      safe" argument, tested instead of asserted;
 *   4. a FORGED item in the store can poison a victim's frontier only into a dangling dep — verify drops the
 *      forgery itself, and the victim's own statement still folds (the write side stays fold-safe).
 */
import { describe, it, expect } from 'vitest';
import { foldRoster } from '../src/security/rosterFold.js';
import { signSpine, verifySpine } from '../src/security/spineStatement.js';
import { createSpineAppender } from '../src/security/spineAppender.js';
import { AgentIdentity } from '../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';

const CIRCLE = 'c';
const body = (id, kind, subject, { payload, parent = null, deps = [] } = {}) =>
  signSpine(id, { kind, circleId: CIRCLE, subject: subject.pubKey ?? subject, payload, parent, deps }).body;

async function ids() {
  return {
    founder: await AgentIdentity.generate(new VaultMemory()),
    bob:     await AgentIdentity.generate(new VaultMemory()),
  };
}

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

describe('robustness 1 — dangling deps (forged / absent hashes in the frontier)', () => {
  it('a dep pointing at a hash the fold never sees is skipped: the statement still folds, deterministically', async () => {
    const { founder, bob } = await ids();
    const join  = body(bob, 'join', bob);
    const evict = body(founder, 'evict', bob, { deps: [join.hash, 'forged-or-unseen-hash'] });
    const a = foldRoster([join, evict], { founders: [founder.pubKey] });
    const b = foldRoster([evict, join], { founders: [founder.pubKey] });   // order-independent too
    expect(a.members).not.toContain(bob.pubKey);      // the evict applied despite the dangling dep
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('robustness 2 — duplicate statements (redelivery)', () => {
  it('folding with duplicates is byte-identical to folding the set once', async () => {
    const { founder, bob } = await ids();
    const join  = body(bob, 'join', bob);
    const evict = body(founder, 'evict', bob, { deps: [join.hash] });
    const once  = foldRoster([join, evict], { founders: [founder.pubKey] });
    const duped = foldRoster([join, evict, evict, join, evict], { founders: [founder.pubKey] });
    expect(JSON.stringify(duped)).toBe(JSON.stringify(once));
  });
});

describe('robustness 3 — a gap that fills later (offline catch-up), and deny-favoring omission', () => {
  it('re-folding once the missing statement arrives converges to the complete answer', async () => {
    const { founder, bob } = await ids();
    const join   = body(bob, 'join', bob);
    const evict  = body(founder, 'evict', bob, { deps: [join.hash] });
    const rejoin = body(bob, 'join', bob, { parent: join.hash, deps: [evict.hash] });
    const complete = foldRoster([join, evict, rejoin], { founders: [founder.pubKey] });
    expect(complete.members).toContain(bob.pubKey);   // the causally-later re-join re-admits
    // A device that missed the re-join, then receives it: the re-fold equals the never-gapped fold.
    const gapped  = foldRoster([join, evict], { founders: [founder.pubKey] });
    const refolded = foldRoster([join, evict, rejoin], { founders: [founder.pubKey] });
    expect(JSON.stringify(refolded)).toBe(JSON.stringify(complete));
    // DENY-FAVORING: what the gap HID was a re-admission — so the gapped view showed bob OUT (deny), never
    // wrongly IN. Omission can only under-admit, never over-admit: that is why lost delivery is safe-degrade.
    expect(gapped.members).not.toContain(bob.pubKey);
  });

  it('omitting the EVICT (the attack direction) keeps the victim IN — visible divergence, not corruption; the reliable tier exists exactly to close it', async () => {
    const { founder, bob } = await ids();
    const join  = body(bob, 'join', bob);
    const evict = body(founder, 'evict', bob, { deps: [join.hash] });
    const withEvict    = foldRoster([join, evict], { founders: [founder.pubKey] });
    const evictOmitted = foldRoster([join], { founders: [founder.pubKey] });
    expect(withEvict.members).not.toContain(bob.pubKey);
    expect(evictOmitted.members).toContain(bob.pubKey);   // an omitted evict lingers — the honest limit
    // (This is the documented divergence a lost spine statement leaves — why spine delivery is RELIABLE
    // (pull-all catch-up), and why a carrier that can omit must never be the content authority.)
  });
});

describe('robustness 4 — a forged store item poisons the frontier only into a dangling dep', () => {
  it('verify drops the forgery; the victim\'s own statement (deps polluted) still folds correctly', async () => {
    const { founder, bob } = await ids();
    const store = memStore();
    const emit = createSpineAppender({ store, signer: founder });
    const join = body(bob, 'join', bob);
    await store.addItems([{ type: 'membership-spine', source: { groupId: CIRCLE, statement: { body: join, sig: 'x', by: bob.pubKey } } }]);
    // An attacker plants a FORGED spine item (garbage body, fake author + hash) in the victim's store.
    await store.addItems([{
      type: 'membership-spine',
      source: { groupId: CIRCLE, statement: { body: { v: 'onderling/spine.v1', kind: 'join', circleId: CIRCLE, subject: 'x', author: 'attacker', parentHash: null, hash: 'fake-hash' }, sig: 'forged', by: 'attacker' } },
    }]);
    // The victim (founder) appends an evict — the appender sources its frontier from the (unverified) store,
    // so `deps` may include the forged hash. That must stay harmless.
    const stmt = await emit({ kind: 'evict', circleId: CIRCLE, subject: bob.pubKey });
    expect(stmt.body.deps).toContain('fake-hash');     // the poisoning happened — now prove it is inert
    // The read side verifies before folding: the forgery fails verify and never reaches the fold.
    const stored = await store.listOpen({ type: 'membership-spine' });
    const verified = stored
      .map((i) => i.source.statement)
      .map((s) => (s.body === join ? { ok: true, body: join } : verifySpine(s, { expectedCircleId: CIRCLE })))
      .filter((v) => v.ok).map((v) => v.body);
    expect(verified.some((b) => b.hash === 'fake-hash')).toBe(false);   // forgery dropped at verify
    const r = foldRoster(verified, { founders: [founder.pubKey] });
    expect(r.members).not.toContain(bob.pubKey);       // the victim's evict folded despite the polluted frontier
  });
});
