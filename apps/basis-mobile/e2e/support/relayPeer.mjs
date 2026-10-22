#!/usr/bin/env node
/**
 * A SECOND PERSON for a phone walk: a real agent node on a relay the emulator can reach, with a circle of its own and
 * an invite the phone opens as a link.
 *
 * Detox drives one phone; a story about two people needs the other one to be real too — the same agent the relay tests
 * boot (`bootRealAgentNode`, the composition the shells use), on a real relay, joined the way a person joins: the phone
 * opens the invite. This script is that other person. It prints one JSON line per step on stdout and keeps running
 * until it is killed (or its stdin closes), so the walk can act on the phone while the peer stays reachable.
 *
 *   node e2e/support/relayPeer.mjs --circle "Vraag Kring" --offering "boormachine uitlenen"
 *     → {"step":"relay","url":"ws://127.0.0.1:…"}  {"step":"ready","invite":"onderling-invite://…","circleId":"…"}
 *
 * The invite carries the relay as the EMULATOR sees it (10.0.2.2 is the host from inside an Android emulator), so the
 * phone needs no relay typed in. `--offering` sets one offering on the peer's persona and RELEASES it to the circle
 * (the per-circle disclosure, said on the circle's lane) — what a person does in Me → personas.
 *
 * Run from apps/basis-mobile; the agent code is imported from the basis app's test support.
 */
import { startJourneyRelay } from '../../../basis/test/support/testRelay.js';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, bindCircleAddresses, teardown,
} from '../../../basis/test/support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../../basis/src/v2/householdRosterPairing.js';
import { buildCircleInviteUri } from '../../../basis/src/v2/circleInvite.js';
import { shareDisclosureToCircle, createDisclosureShareMemo } from '../../../basis/src/core/handlers/personaPropsUpdate.js';

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

const circleName = arg('circle', 'Walk Kring');
const offering = arg('offering');
const handle = arg('handle', 'bram');
// how the phone reaches the host: 10.0.2.2 on the Android emulator; a real phone on the LAN needs the host's address
const phoneHost = arg('phone-host', '10.0.2.2');

const relay = await startJourneyRelay();
say({ step: 'relay', url: relay.url });
const peer = await bootRealAgentNode(handle, { taskLane: true });
await connectNodesOverRelay([peer], { relayUrl: relay.url });

const groupId = `walk-${Date.now().toString(36)}`;
await createCircle(peer, { groupId, name: circleName });
await bindCircleAddresses([peer], groupId);
await bindCircleAddressKeysFor({ agent: peer.agent, circleId: groupId });

const call = (app, op, args) => peer.agent.callSkill(app, op, args);
await call('agents', 'setProfileProperty', { id: 'default', key: 'handle', value: handle }).catch(() => null);
if (offering) {
  const set = await call('agents', 'setProfileDriver', { id: 'default', key: 'walk-offering', kind: 'offering', text: offering, tags: '' });
  const shown = await call('agents', 'setProfileDisclosure', { id: 'default', contextId: groupId, key: 'walk-offering', enabled: true });
  const said = await shareDisclosureToCircle({
    callSkill: call, emitMemberProps: (a) => peer.agent.emitMemberProps(a),
    circleId: groupId, personaId: 'default', lastShared: createDisclosureShareMemo(),
  });
  say({ step: 'offering', set: !!set?.ok, released: !!shown?.ok, said: said?.ok ? said.via ?? true : said });
}

const port = new URL(relay.url).port;
const invite = await buildCircleInviteUri({
  callSkill: call, circleId: groupId,
  adminPeerAddr: peer.agent.circleSelf?.(groupId)?.webid ?? peer.pubKey,
  relayUrl: `ws://${phoneHost}:${port}`,
});
if (invite?.error) { say({ step: 'error', error: invite.error }); process.exit(1); }
say({ step: 'ready', invite: invite.uri, circleId: groupId, circleName });

const stop = async () => {
  try { await teardown(peer); } catch { /* best-effort */ }
  try { await relay.close(); } catch { /* best-effort */ }
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.stdin.on('end', stop);
process.stdin.resume();
