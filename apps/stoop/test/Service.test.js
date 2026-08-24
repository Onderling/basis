/**
 * createStoopService — §1b op→atom adapter (PLAN-capability-arc §1b), the stoop counterpart of the
 * household pilot's `callCapability` suite (`apps/basis/test/householdApp.test.js`).
 *
 * Stoop is NOT dissolved onto a CircleItemStore — it keeps its legacy `defineSkill` handlers whose args ride
 * in a single `DataPart` (`dataArgs(parts)` in `src/skills/index.js`). So the service wraps `args` in that
 * DataPart (`callSkill`) and routes `(atom × noun)` → opId → the real handler (`callCapability`). The bespoke
 * skills are reused verbatim via `buildSkills` — nothing here re-implements a skill.
 *
 * NB on the manifest's declared surface (verified against `resolveCapability` while authoring this test):
 *   - `remove·{post,ask,offer,lend,request}` → cancelRequest, `complete·lend` → markReturned,
 *     `reassign·lend` → assignLend, `claim·post` → respondToItem, `remove·group-leave` → leaveGroup,
 *     `list·member` → listGroupMembers — all REAL `buildSkills` ops (covered below).
 *   - `add·post` / `list·post` / `add·{contact,member}` resolve to conflictDisputeWizard / listFeed / startDm,
 *     which are basis-SIDE aliases/wizards, NOT real stoop `buildSkills` skills — so those pairs are
 *     deliberately NOT exercised through this functionality-side service (they'd route to an opId this
 *     service doesn't own). See the orchestrator report for the full resolution table.
 */
import { describe, it, expect } from 'vitest';
import { createStoopService } from '../src/Service.js';

const ctx = (by = 'webid:alice') => ({ by });

// Seed a legacy `type: 'lend'` item straight onto the bound store (assignLend requires `type === 'lend'`,
// which the canonical postRequest translator stores as `type:'offer', kind:'lend'`, not `type:'lend'`).
// A lend as the app actually writes one since the vocabulary refresh: an OFFER whose kind says it
// comes back. This seeded `type: 'lend'` — a flat type nothing produces any more — which is why the
// lend affordances could be addressed here while being unreachable from every real surface.
const seedLend = (svc, text, by = 'webid:alice') =>
  svc.store.addItems([{ type: 'offer', kind: 'lend', text, requiredSkills: [], visibility: 'household', source: {} }], { actor: by })
    .then(([i]) => i);

describe('createStoopService — legacy callSkill (DataPart wrapper over buildSkills)', () => {
  it('wraps args in a single DataPart and reaches the real handler; unknown op throws', async () => {
    const svc = createStoopService({ groupId: 'g1' });
    const posted = await svc.callSkill('postRequest', { text: 'ladder', intent: 'ask' }, ctx());
    expect(typeof posted.requestId).toBe('string');                       // real handler ran + stored
    const open = await svc.callSkill('listOpen', {}, ctx());
    expect(open.items.map((i) => i.text)).toContain('ladder');
    await expect(svc.callSkill('noSuchOp', {}, ctx())).rejects.toThrow(/unknown op/);
  });
});

describe('createStoopService — callCapability atom-dispatch over the real skills (§1b)', () => {
  it('(a) representative bespoke ops route THROUGH their op (via:op, correct opId)', async () => {
    const svc = createStoopService({ groupId: 'g1' });
    const c = ctx();

    // post — remove·post → cancelRequest (bespoke-first, really removes the item)
    const posted = await svc.callSkill('postRequest', { text: 'need a drill', intent: 'ask' }, c);
    expect((await svc.callSkill('listOpen', {}, c)).items.map((i) => i.text)).toContain('need a drill');
    const removed = await svc.callCapability('remove', 'post', { requestId: posted.requestId }, c);
    expect(removed).toMatchObject({ ok: true, via: 'op', opId: 'cancelRequest' });
    expect((await svc.callSkill('listOpen', {}, c)).items.map((i) => i.text)).not.toContain('need a drill');

    // post — claim·post → respondToItem (reaches the real handler; chat isn't wired here so it reports so)
    const post2 = await svc.callSkill('postRequest', { text: 'borrow a tent', intent: 'ask' }, c);
    const claimed = await svc.callCapability('claim', 'post', { itemId: post2.requestId, body: 'I can help' }, c);
    expect(claimed).toMatchObject({ ok: true, via: 'op', opId: 'respondToItem' });
    expect(claimed.result).toMatchObject({ error: 'chat-not-wired' });    // real handler, no chat controller

    // lend — reassign·offer → assignLend. The ATOM addresses `offer`, because that is the noun; a
    // lend is a KIND of offer, and the capability layer resolves ops by noun alone. The op's own
    // guard is what keeps it honest — `assignLend` refuses an offer that is not a lend.
    const lendA = await seedLend(svc, 'a ladder');
    const reassigned = await svc.callCapability('reassign', 'offer', { itemId: lendA.id, borrowerWebid: 'webid:bob' }, c);
    expect(reassigned).toMatchObject({ ok: true, via: 'op', opId: 'assignLend' });
    expect(reassigned.result.error).toBeUndefined();
    expect(reassigned.result.item).toBeTruthy();

    // lend — complete·offer → markReturned, same reasoning as above.
    const lendB = await seedLend(svc, 'a hedge trimmer');
    const returned = await svc.callCapability('complete', 'offer', { requestId: lendB.id }, c);
    expect(returned).toMatchObject({ ok: true, via: 'op', opId: 'markReturned' });
    expect(returned.result.item.completedAt).toBeTruthy();

    // group-leave — remove·group-leave → leaveGroup (INERT gated capability; routing only)
    const left = await svc.callCapability('remove', 'group-leave', { groupId: 'g1' }, c);
    expect(left).toMatchObject({ ok: true, via: 'op', opId: 'leaveGroup' });
    expect(typeof left.result.leaveMarkerId).toBe('string');
  });

  it('(b) an atom ALIAS canonicalises to the same op (delete → remove)', async () => {
    const svc = createStoopService({ groupId: 'g1' });
    const c = ctx();
    const viaRemove = await svc.callCapability('remove', 'group-leave', { groupId: 'g1' }, c);
    const viaDelete = await svc.callCapability('delete', 'group-leave', { groupId: 'g1' }, c);   // alias of remove
    expect(viaRemove.opId).toBe('leaveGroup');
    expect(viaDelete).toMatchObject({ ok: true, via: 'op', opId: 'leaveGroup' });

    // and on a content noun: delete·lend and remove·lend both resolve to cancelRequest
    const lend = await seedLend(svc, 'a saw');
    const del = await svc.callCapability('delete', 'lend', { requestId: lend.id }, c);
    expect(del).toMatchObject({ ok: true, via: 'op', opId: 'cancelRequest' });
  });

  it('(c) an undeclared/unimplemented (atom × noun) returns {ok:false, code:unimplemented} — generic never fires', async () => {
    const svc = createStoopService({ groupId: 'g1' });
    const c = ctx();
    expect(await svc.callCapability('add', 'ghost', {}, c)).toMatchObject({ ok: false, code: 'unimplemented' });
    // `post` declares add/list/claim/remove — NOT complete — and no op derives complete·post
    expect(await svc.callCapability('complete', 'post', {}, c)).toMatchObject({ ok: false, code: 'unimplemented' });
  });

  it('(d) backward-compat: the same op via the legacy callSkill path returns the same result as via callCapability', async () => {
    const svc = createStoopService({ groupId: 'g1' });   // members: null → listGroupMembers is deterministic ({members:[]})
    const c = ctx();
    const legacy = await svc.callSkill('listGroupMembers', {}, c);
    const viaCap = await svc.callCapability('list', 'member', {}, c);
    expect(viaCap).toMatchObject({ ok: true, via: 'op', opId: 'listGroupMembers' });
    expect(viaCap.result).toEqual(legacy);
  });
});
