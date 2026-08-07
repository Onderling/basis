// J-reachability: the SIGNED reachability oracle across devices, over the relay.
//
// A device answers "who can I reach directly" with a SIGNED, versioned claim; a peer invokes that
// over the relay and verifies it before trusting it for hop routing. This exercises
// signReachabilityClaim / verifyReachabilityClaim end to end across two devices — including the
// versioned wire format (`onderling/reachability.v1`, the string migration) and the forge/replay
// guards — the signed-claim gossip path that no other journey covers.
//
// The oracle is a MESH concept (direct reach), so the direct-peer topology is seeded explicitly here
// (in production it comes from discovery); the point under test is the CLAIM: its signature, its
// version, its issuer binding and its replay guard, all over a real transport.
import { Agent, AgentIdentity, Parts, PeerGraph, verifyReachabilityClaim } from '@onderling/core';
import { VaultMemory }    from '@onderling/vault';
import { RelayTransport } from '@onderling/transports';
import { wait, checker }  from './_util.mjs';

export const name = 'J-reachability (signed reachability oracle across devices)';

// Test scope: every caller may learn every direct peer (the claim mechanics, not disclosure — that
// is covered elsewhere). A production scope answers "peers I share a circle with".
const OPEN = (_caller, peers) => peers;

export async function run({ relayUrl }) {
  const { results, check } = checker();

  async function member() {
    const id = await AgentIdentity.generate(new VaultMemory());
    const a = new Agent({ identity: id, transport: new RelayTransport({ relayUrl, identity: id }), peers: new PeerGraph() });
    a.enableReachabilityOracle({ peerScope: OPEN });
    return a;
  }
  const ann = await member(), bob = await member(), cato = await member();
  const all = [ann, bob, cato];
  for (const x of all) for (const y of all) if (x !== y) x.addPeer(y.address, y.address);

  try {
    for (const a of all) await a.start();
    await wait(1800);
    check('all three devices online', all.every((a) => a.transport.connected));

    // Seed Bob's DIRECT-peer graph: Bob directly reaches Ann + Cato (topology under test).
    await bob.peers.upsert({ pubKey: ann.pubKey, hops: 0, reachable: true });
    await bob.peers.upsert({ pubKey: cato.pubKey, hops: 0, reachable: true });

    // Ann asks Bob "who can you reach?" — the skill invocation travels over the relay.
    const claim = Parts.data(await ann.invoke(bob.address, 'reachable-peers', []));
    check('Bob returned a signed reachability claim over the relay',
      !!claim && !!claim.body && typeof claim.sig === 'string');
    check('the claim carries the versioned wire format (onderling/reachability.v1)',
      claim.body.v === 'onderling/reachability.v1');
    check('Ann verifies Bob’s claim — signature + issuer binding',
      verifyReachabilityClaim(claim, { expectedIssuer: bob.pubKey }).ok === true);
    check('the claim lists Bob’s direct peers (Ann + Cato), sorted',
      JSON.stringify(claim.body.p) === JSON.stringify([ann.pubKey, cato.pubKey].sort()));

    // Forge guard: a claim we expected from someone else is refused (reflection / issuer mismatch).
    check('a claim attributed to the wrong issuer is refused',
      verifyReachabilityClaim(claim, { expectedIssuer: cato.pubKey }).ok === false);

    // Replay guard: once a sequence is accepted, offering the same one again is rejected.
    const accepted = verifyReachabilityClaim(claim, { expectedIssuer: bob.pubKey });
    check('a replayed claim (seq ≤ last accepted) is rejected',
      verifyReachabilityClaim(claim, { expectedIssuer: bob.pubKey, lastSeenSeq: accepted.newLastSeq }).ok === false);
  } finally {
    for (const a of all) await a.transport.disconnect().catch(() => {});
  }
  return results;
}
