// Mute that MUTES — wave 1's first twin-proven item (story 1: "Ella mutes a circle that got noisy…
// nothing from it reaches her device again until she says so").
//
// This journey composes the SAME membrane fragment both shells spread (`makeCircleMembraneOpts`), over
// the SAME store the toggles write (`createMemberOverrideStore`) — so green here proves the path the
// product uses, not a lookalike. The entry check rides the twin-reachability gate: `declaredOp` asserts
// the mute surface exists on basis's manifest before anything behavioural is measured.
//
// Sequence: B messages A (arrives) → A mutes the circle (chatOff override) → B messages again (DROPPED,
// A's inbox proves it) → A unmutes → traffic resumes (mute is a door, not a trapdoor).
import { createSecureAgent } from '@onderling/secure-agent';
import { VaultMemory } from '@onderling/vault';
// The modules, not the barrel: basis's barrel drags `localisation` → JSON imports that raw Node refuses
// without assertions. These two ARE what we're proving against; the barrel is web-shell packaging.
import { createMemberOverrideStore } from '../../basis/src/v2/circlePolicyStore.js';
import { makeCircleMembraneOpts, makeCircleGroupsIndex } from '../../basis/src/v2/circleMembrane.js';
import { wait, checker, declaredOp } from './_util.mjs';

export const name = 'mute that mutes (the membrane bites)';

export async function run({ relayUrl }) {
  const { results, check } = checker();

  // The reachability gate first: the person-mute surface must be DECLARED, or this journey is proving
  // something no user can reach.
  await declaredOp('basis', 'mute');
  check('the mute surface is declared (twin-reachability gate)', true);

  // A's membrane: the same store shape the shells wire (web: localStorage IO; mobile: AsyncStorage IO;
  // here: a Map — the IO is the injectable seam, the store logic is the shared part under test).
  const mem = new Map();
  const overrideStore = createMemberOverrideStore({
    load: async (id) => mem.get(id) ?? null,
    save: async (id, v) => { mem.set(id, v); },
  });
  const groupsIndex = makeCircleGroupsIndex();

  const a = await createSecureAgent({
    vault: new VaultMemory(),
    transportMode: 'relay',
    ...makeCircleMembraneOpts({ overrideStore, groupsIndex }),
  });
  const b = await createSecureAgent({ vault: new VaultMemory(), transportMode: 'relay' });

  const aInbox = [];
  try {
    await a.relay.connect({ relayUrl, awaitReady: true, onPeerMessage: (m) => aInbox.push(m) });
    await b.relay.connect({ relayUrl, awaitReady: true });

    // The G12 binding both shells perform at the roster read (`bindCircleAddressKeys`): address → the
    // peer's canonical identity key. Without it the enforcement gate cannot name who is speaking and
    // fails OPEN — which is honest degradation in the product and a vacuous pass in a proof.
    a.registerPeerAddress(b.relay.address, b.identity.pubKey);
    b.registerPeerAddress(a.relay.address, a.identity.pubKey);

    // Both members of one circle, per the index the roster feed (`feedHouseholdRoster`) would fill.
    // webid ≡ canonical pubKey in basis — the recorded fact the membrane's memberMap also relies on.
    groupsIndex.add('circle-x', b.identity.pubKey);
    groupsIndex.add('circle-x', a.identity.pubKey);

    await b.peer.sendTo(a.relay.address, { n: 1, text: 'before mute' });
    await wait(600);
    const before = aInbox.length;
    check('pre-mute: a shared-circle message ARRIVES', before >= 1);
    check('the agent reports the membrane wired', a.securityStatus().circleEnforcementWired === true);

    // The toggle's write — the exact store call both shells' mute switch performs.
    await overrideStore.update('circle-x', { chatOff: true });
    let sendErr = null;
    try { await b.peer.sendTo(a.relay.address, { n: 2, text: 'during mute' }, { retryDelays: [] }); }
    catch (err) { sendErr = err; }   // an application-level refusal is also a valid "did not land"
    await wait(600);
    check('muted: the message does NOT land (inbox unchanged)', aInbox.length === before);

    await overrideStore.update('circle-x', { chatOff: false });
    await b.peer.sendTo(a.relay.address, { n: 3, text: 'after unmute' });
    await wait(600);
    check('unmuted: traffic resumes (a door, not a trapdoor)', aInbox.length === before + 1);
    void sendErr;
  } finally {
    await a.shutdown().catch(() => {});
    await b.shutdown().catch(() => {});
  }
  return results;
}
