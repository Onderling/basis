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
 * `--talk` makes the peer a person who CONVERSES (the messaging story): it composes the contact thread, reports what
 * it hears, and speaks when the walk tells it to. It hears: one line per new circle chat line from someone else
 * (`{"step":"circle-heard","text":…}`) and per new inbound contact turn (`{"step":"contact-heard","text":…,"from":…}`).
 * It speaks on a JSON line on stdin:
 *   {"do":"circle-say","text":"…"}     a circle chat line in its circle, over the signed path
 *   {"do":"contact-say","text":"…"}    a contact turn to the person it last heard from, else the first other member
 * and answers each with `{"step":"circle-said"|"contact-said","ok":…}`.
 *
 * Run from apps/basis-mobile; the agent code is imported from the basis app's test support.
 */
import { startJourneyRelay } from '../../../basis/test/support/testRelay.js';
import readline from 'node:readline';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, bindCircleAddresses, teardown, sendCircleChat, readRoster,
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
const talk = process.argv.includes('--talk');

const relay = await startJourneyRelay();
say({ step: 'relay', url: relay.url });
const peer = await bootRealAgentNode(handle, { itemsLane: true, contactChannel: talk });
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
say({
  step: 'ready', invite: invite.uri, circleId: groupId, circleName,
  // which address is which, so a walk can name the one a phone used (a short prefix each)
  addresses: {
    chatKey: String(peer.pubKey ?? '').slice(0, 12),
    circleSelf: String(peer.agent.circleSelf?.(groupId)?.webid ?? '').slice(0, 12),
    circleAddress: String(peer.agent.circleAddressFor?.(groupId) ?? '').slice(0, 12),
  },
});

if (talk) {
  // HEARING: what landed in the peer's own stores (its chat log, its stored contact threads), polled — the same
  // reads the shells render from, not a hook beside them.
  const heardChat = new Set(); const heardTurns = new Set(); let lastFrom = null;
  const listen = async () => {
    for (const e of peer.chatEvents) {
      if (!e?.id || heardChat.has(e.id) || e.actor === peer.pubKey || e.payload?.circleId !== groupId || !e.payload?.text) continue;
      heardChat.add(e.id);
      say({ step: 'circle-heard', text: e.payload.text });
    }
    const turns = await peer.contactThreadChannel.rehydrateAll().catch(() => []);
    for (const turn of turns) {
      const key = turn.messageId ?? `${turn.contactId}:${turn.ts}`;
      if (turn.origin !== 'bot' || heardTurns.has(key)) continue;   // 'bot' = the other side's turn
      heardTurns.add(key);
      const full = (await peer.contactThreadChannel.rehydrate(turn.contactId)).find((x) => (x.messageId ?? null) === (turn.messageId ?? null));
      lastFrom = turn.contactId;
      say({ step: 'contact-heard', text: full?.text ?? turn.text ?? null, from: turn.contactId });
    }
  };
  setInterval(() => { listen().catch((err) => say({ step: 'listen-error', error: String(err?.message ?? err) })); }, 1000);

  // SPEAKING: one JSON command per stdin line.
  readline.createInterface({ input: process.stdin }).on('line', async (line) => {
    let cmd = null;
    try { cmd = JSON.parse(line); } catch { return; }
    try {
      if (cmd.do === 'dump') {
        // what the peer holds, for a walk that has to say WHICH branch failed: its stored turns, what fell to the
        // default handler (no lane claimed it), and the contact turns it refused
        const turns = await peer.contactThreadChannel.rehydrateAll().catch((e) => [{ error: String(e?.message ?? e) }]);
        say({
          step: 'dump',
          turns: turns.map((x) => ({ contactId: x.contactId, origin: x.origin, text: x.text ?? null })),
          unrouted: (peer.received ?? []).map((r) => r?.payload?.type ?? r?.payload?.subtype ?? typeof r?.payload),
          refused: peer.contactTurnsRefused ?? [],
        });
      } else if (cmd.do === 'circle-say') {
        const r = await sendCircleChat(peer, { groupId, msgId: `peer-${Date.now().toString(36)}`, text: cmd.text });
        say({ step: 'circle-said', ok: !r?.error, error: r?.error ?? null });
      } else if (cmd.do === 'contact-say') {
        let to = lastFrom;
        if (!to) {
          const roster = await readRoster(peer, groupId);
          const mine = new Set([peer.pubKey, peer.agent.circleSelf?.(groupId)?.webid].filter(Boolean));
          const other = (roster ?? []).map((m) => m.webid ?? m.pubKey ?? null).find((id) => id && !mine.has(id));
          to = other ?? null;
        }
        if (!to) { say({ step: 'contact-said', ok: false, error: 'nobody to talk to yet' }); return; }
        const { sent } = peer.contactThreadChannel.sendTurn({ peerAddr: to, threadId: to, text: cmd.text });
        const r = await sent;
        say({ step: 'contact-said', ok: r?.delivered !== false, to, result: r ?? null });
      }
    } catch (err) { say({ step: `${cmd.do}-error`, error: String(err?.message ?? err) }); }
  });
}

const stop = async () => {
  try { await teardown(peer); } catch { /* best-effort */ }
  try { await relay.close(); } catch { /* best-effort */ }
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.stdin.on('end', stop);
process.stdin.resume();
