// J-governance: EQUIVOCATION detection (the L3 fork-proof) across devices, over the relay.
//
// The attack: one member signs two contradictory votes on the SAME proposal off the SAME parent
// and sends each to a DIFFERENT peer (split-brain / double-voting). Seen alone, each half looks
// like an honest vote — the equivocation is invisible to any single peer. The self-verifying
// fork-proof only appears when the two halves MEET (peers sync their governance logs); at that
// moment every device that holds both computes the SAME `disputed` set (P10 — agreed things are
// computed identically everywhere), with no server adjudicating.
//
// This drives the REAL shared primitive we just lifted — `createAuthorChain` from @onderling/core,
// the exact per-author hash-chain + fork-proof that governance binds — over a real transport across
// three separate agents. (Ed25519 signing is the orthogonal L2 layer, exercised by J-security; this
// journey is about L3 equivocation detection.) The content serializer below mirrors governanceChain's
// binding: an event's identity is its CONTENT, excluding the chain fields and the volatile `at`.
import { Agent, AgentIdentity, Parts, createAuthorChain } from '@onderling/core';
import { VaultMemory }    from '@onderling/vault';
import { RelayTransport } from '@onderling/transports';
import { wait, checker }  from './_util.mjs';

export const name = 'J-governance (equivocation / fork-proof across devices)';

// Mirror of governanceChain's body serialization: identity = vote CONTENT, not the chain fields / `at`.
const CONTENT = ['event', 'proposalId', 'voter', 'choice', 'action', 'subject', 'status'];
const stableBody = (e) => CONTENT.filter((k) => e[k] !== undefined).map((k) => `${k}=${e[k]}`).join('&');
const chain = createAuthorChain(stableBody);

const vote = (proposalId, voter, choice, at = 0) => ({ event: 'vote', proposalId, voter, choice, at });
const isGovEvent = (o) => o && typeof o === 'object' && typeof o.author === 'string' && typeof o.hash === 'string';

export async function run({ relayUrl }) {
  const { results, check } = checker();

  async function member(tag) {
    const id = await AgentIdentity.generate(new VaultMemory());
    const a = new Agent({ identity: id, transport: new RelayTransport({ relayUrl, identity: id }) });
    a.tag = tag;
    a.govLog = [];                         // this device's accumulated governance events (from the wire)
    a.on('message', (m) => {
      let o = null;
      try { o = JSON.parse(Parts.text(m.parts)); } catch { /* a non-governance message */ }
      if (isGovEvent(o) && !a.govLog.some((e) => e.hash === o.hash)) a.govLog.push(o);
    });
    return a;
  }
  // What THIS device concludes from the governance events it currently holds.
  const disputed = (a) => [...chain.foldDisputes({ events: a.govLog })].sort().join(',');

  const mallory = await member('mallory');
  const ann     = await member('ann');
  const bob     = await member('bob');
  const all = [mallory, ann, bob];
  for (const x of all) for (const y of all) if (x !== y) x.addPeer(y.address, y.address);
  const send = (from, to, event) => from.message(to.address, JSON.stringify(event));

  try {
    for (const a of all) await a.start();
    await wait(1800);
    check('all three devices online', all.every((a) => a.transport.connected));

    // ── Mallory equivocates: two contradictory votes on p1, both off the same parent (genesis) ──
    const parent = 'genesis';
    const yes = chain.chainEvent(vote('p1', mallory.address, 'yes', 1), { author: mallory.address, parentHash: parent });
    const no  = chain.chainEvent(vote('p1', mallory.address, 'no',  2), { author: mallory.address, parentHash: parent });
    check('the two halves ARE a genuine fork (same author + parent, divergent hash)',
      yes.author === no.author && yes.parentHash === no.parentHash && yes.hash !== no.hash);

    // ── Split-brain delivery over the relay: Ann hears YES, Bob hears NO ──
    await send(mallory, ann, yes);
    await send(mallory, bob, no);
    await wait(1000);
    check('Ann received her half over the relay', ann.govLog.some((e) => e.hash === yes.hash));
    check('Bob received his half over the relay', bob.govLog.some((e) => e.hash === no.hash));
    check('per-peer the attack is INVISIBLE — each half alone disputes nobody',
      disputed(ann) === '' && disputed(bob) === '');

    // ── The halves MEET: Ann and Bob sync their governance logs to each other over the relay ──
    for (const e of [...ann.govLog]) await send(ann, bob, e);
    for (const e of [...bob.govLog]) await send(bob, ann, e);
    await wait(1200);
    check('once the halves meet, Ann detects the fork and disputes Mallory', disputed(ann) === mallory.address);
    check('Bob converges on the SAME disputed set (identical on every device)', disputed(bob) === mallory.address);

    // ── An HONEST author advancing her chain (a legitimate mind-change) is NEVER disputed ──
    const g0 = chain.chainEvent(vote('p2', ann.address, 'yes', 1), { author: ann.address, parentHash: 'genesis2' });
    const g1 = chain.chainEvent(vote('p2', ann.address, 'no',  2), { author: ann.address, parentHash: g0.hash }); // forward, not a fork
    await send(ann, bob, g0);
    await send(ann, bob, g1);
    await wait(900);
    check('an honest forward mind-change is NOT a fork — only Mallory stays disputed',
      disputed(bob) === mallory.address);
  } finally {
    for (const a of all) await a.transport.disconnect().catch(() => {});
  }
  return results;
}
