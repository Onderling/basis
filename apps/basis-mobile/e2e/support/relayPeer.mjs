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
 * `--features lists` switches circle features on (the admin's policy update, signed, on the governance lane).
 * In `--talk` mode the peer also keeps the circle's LISTS on stdin commands: `list-create`, `list-add` and `lists-dump`
 * (every list and its open entries), through the same `lists` ops the shells call.
 *
 * and the circle's TASKS: `task-claim` and `task-complete` (the open task whose words hold `text`) and `tasks-dump`
 * (every open task with its status and who holds it, plus the peer's own addresses), through the same `tasks` ops.
 *
 * `--talk` makes the peer a person who CONVERSES (the messaging story): it composes the contact thread, reports what
 * it hears, and speaks when the walk tells it to. It hears: one line per new circle chat line from someone else
 * (`{"step":"circle-heard","text":…}`) and per new inbound contact turn (`{"step":"contact-heard","text":…,"from":…}`).
 * It speaks on a JSON line on stdin:
 *   {"do":"circle-say","text":"…"}     a circle chat line in its circle, over the signed path
 *   {"do":"contact-say","text":"…"}    a contact turn to the person it last heard from, else the first other member
 *   {"do":"roster"}                    its circle's other members as its own roster has them → {"step":"roster","rows":[…]}
 * and answers each with `{"step":"circle-said"|"contact-said","ok":…}`.
 *
 * `--join` makes the peer a person who JOINS the phone's circle instead of founding one (the first-five-minutes story:
 * the phone makes the circle and its invite brings the peer in). It prints `{"step":"ready","waitingForInvite":true}` and joins
 * on `{"do":"join","invite":"onderling-invite://…"}` (the link the phone's invite card shows), the way the shells join
 * (`joinCircleFromInvite`), then answers `{"step":"joined","ok":…,"circleId":…}`. `--talk` works the same after.
 *
 * Run from apps/basis-mobile; the agent code is imported from the basis app's test support.
 */
import { startJourneyRelay } from '../../../basis/test/support/testRelay.js';
import readline from 'node:readline';
import { makerRootKeyStore, MAKER_HANDLE, MAKER_RELAY_PORT, lanAddress } from './makerCard.mjs';
import { networkInterfaces } from 'node:os';
import {
  bootRealAgentNode, connectNodesOverRelay, createCircle, bindCircleAddresses, teardown, sendCircleChat, readRoster,
} from '../../../basis/test/support/pairRealAgents.js';
import { bindCircleAddressKeysFor } from '../../../basis/src/v2/householdRosterPairing.js';
import { DEFAULT_CIRCLE_POLICY } from '../../../basis/src/v2/circlePolicy.js';
import { buildCircleInviteUri, joinCircleFromInvite } from'../../../basis/src/v2/circleInvite.js';
import { shareDisclosureToCircle, createDisclosureShareMemo } from '../../../basis/src/core/handlers/personaPropsUpdate.js';

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const say = (o) => process.stdout.write(`${JSON.stringify(o)}\n`);

const circleName = arg('circle', 'Walk Kring');
const offering = arg('offering');
// the maker's handle is part of its card, so it is fixed with it
const handle = process.argv.includes('--maker') ? MAKER_HANDLE : arg('handle', 'bram');
// ONE NAME FOR THE RELAY, used by everyone. A relay a deployment runs has one public name; here the host's relay was
// `127.0.0.1` to this peer and `10.0.2.2` (the emulator's alias for the host) to the phone, so the two recorded the same
// relay under two urls. A circle's points carry the peer's spelling, the phone's socket did not match it, and routing
// fell to live NKN — a harness artefact that looked like a lost message (found by instrumenting the route, 2026-11-11).
// So both sides dial the host's LAN address, which the emulator reaches too. `--phone-host` overrides it; 10.0.2.2 is
// only a last resort (the host cannot dial it, so the two names come back).
const phoneHost = arg('phone-host', lanAddress() ?? '10.0.2.2');
const makerMode = process.argv.includes('--maker');
const talk = process.argv.includes('--talk') || makerMode;
const joinMode = process.argv.includes('--join');

// the maker's relay is on the fixed port its card names; both sides dial it under the LAN address, as the card says
const relay = await startJourneyRelay(makerMode ? { port: MAKER_RELAY_PORT } : {});
const relayUrl = phoneHost === '10.0.2.2' ? relay.url : `ws://${phoneHost}:${new URL(relay.url).port}`;
say({ step: 'relay', url: relayUrl });
// `--maker`: the feedback contact an e2e build carries (e2e/support/makerCard.mjs): a FIXED root seed, so this peer is
// the same person on every run and its card is the one baked into that build
const makerOpts = makerMode ? { agentOpts: { rootKeyStore: await makerRootKeyStore() } } : {};
const peer = await bootRealAgentNode(handle, { itemsLane: true, contactChannel: talk, ...makerOpts });
await connectNodesOverRelay([peer], { relayUrl });

const call = (app, op, args) => peer.agent.callSkill(app, op, args);
// the circle this peer is in: its own (founded here), or, in `--join` mode, the phone's once the invite arrives
let groupId = (joinMode || makerMode) ? null : `walk-${Date.now().toString(36)}`;
if (!joinMode && !makerMode) {
await createCircle(peer, { groupId, name: circleName });
await bindCircleAddresses([peer], groupId);
await bindCircleAddressKeysFor({ agent: peer.agent, circleId: groupId });

// `--features lists,calendar`: the admin switches circle features ON, as the settings screen's save does: a signed
// policy update on the governance lane, which every member (the phone too) folds into its copy of the policy
const features = (arg('features', '') ?? '').split(',').map((x) => x.trim()).filter(Boolean);
if (features.length) {
  const policy = { ...DEFAULT_CIRCLE_POLICY, features: { ...DEFAULT_CIRCLE_POLICY.features, ...Object.fromEntries(features.map((f) => [f, true])) } };
  const st = await peer.agent.emitPolicyUpdate?.({ groupId, policy, version: 2 }).catch((e) => ({ error: String(e?.message ?? e) }));
  say({ step: 'features', on: features, ok: !!st && !st?.error });
}
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

}

if (makerMode) {
  // the feedback contact: in no circle, reachable as a person; its card (made by its own op) is what the walk compares
  // with the card the e2e build carries
  await call('agents', 'setProfileProperty', { id: 'default', key: 'handle', value: handle }).catch(() => null);
  // the feedback persona is OPEN to first messages, as the deployed one is (decisions.md 2026-11-12: "the feedback
  // persona is open"): a person's default is 'request', which holds a stranger's note as a message request and keeps
  // it out of the thread (the walk's first runs: sent, never in the maker's thread, nothing refused)
  const firstMessages = await peer.agent.setFirstMessages('open');
  if (firstMessages !== 'open') throw new Error(`the maker could not open its door to first messages: ${firstMessages}`);
  const card = (await call('pinboard', 'getContactShareQr', {}).catch(() => null))?.payload ?? null;
  // `webid`: who it is (the build's card names the same one; the live card adds this run's relay, so cards differ)
  // `relayUrl`: the one spelling both sides dial, the same the e2e build's card names (made at build time)
  say({ step: 'ready', maker: true, webid: peer.pubKey, card, relayUrl });
} else if (joinMode) {
  await call('agents', 'setProfileProperty', { id: 'default', key: 'handle', value: handle }).catch(() => null);
  say({ step: 'ready', waitingForInvite: true, relayUrl });
} else {
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
}

if (joinMode) {
  // JOINING: the phone's invite, the way a shell joins (the wizard's own call), then the circle's addresses bound
  readline.createInterface({ input: process.stdin }).on('line', async (line) => {
    let cmd = null;
    try { cmd = JSON.parse(line); } catch { return; }
    if (cmd?.do !== 'join' || groupId) return;
    try {
      const r = await joinCircleFromInvite({
        inviteUri: cmd.invite, callSkill: call, sendPeerRedeem: peer.sendPeerRedeem, handle, rulesAccepted: true,
        circleAddressFor: (cid) => peer.agent.circleAddressFor(cid),
        signCircleLink: (src, dst, addr) => peer.agent.signCircleLink?.(src, dst, addr) ?? null,
      });
      if (r?.ok) {
        groupId = r.circleId;
        await bindCircleAddresses([peer], groupId).catch(() => {});
        await bindCircleAddressKeysFor({ agent: peer.agent, circleId: groupId }).catch(() => {});
      }
      say({ step: 'joined', ok: !!r?.ok, circleId: r?.circleId ?? null, error: r?.ok ? null : (r?.reason ?? r?.error ?? null) });
    } catch (err) { say({ step: 'joined', ok: false, error: String(err?.message ?? err) }); }
  });
}

if (talk) {
  // HEARING: what landed in the peer's own stores (its chat log, its stored contact threads), polled — the same
  // reads the shells render from, not a hook beside them.
  const heardChat = new Set(); const heardTurns = new Set(); let lastFrom = null;
  const listen = async () => {
    for (const e of peer.chatEvents) {
      if (!groupId || !e?.id || heardChat.has(e.id) || e.actor === peer.pubKey || e.payload?.circleId !== groupId || !e.payload?.text) continue;
      heardChat.add(e.id);
      say({ step: 'circle-heard', text: e.payload.text, from: e.actor ?? null });
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
          // first messages held as requests (the door), not in a thread: a held note is THIS branch
          requests: ((await call('pinboard', 'listMessageRequests', {}).catch(() => null))?.requests ?? []).map((q) => ({ from: q?.contactId ?? q?.from ?? null, text: q?.text ?? null })),
        });
      } else if (cmd.do === 'roster') {
        // the circle's members as the peer's own roster has them (its own rows left out): who joined, under which name
        const mine = new Set([peer.pubKey, peer.agent.circleSelf?.(groupId)?.webid].filter(Boolean));
        const rows = (await readRoster(peer, groupId)).filter((m) => !mine.has(m?.webid ?? m?.pubKey ?? null));
        say({ step: 'roster', rows });
      } else if (cmd.do === 'list-create') {
        // the circle's lists, through the same ops the shells call (`lists` app): what the peer makes, the phone sees
        const r = await call('lists', 'createList', { circleId: groupId, text: cmd.list });
        say({ step: 'list-created', ok: r?.ok !== false && !r?.error, result: r ?? null });
      } else if (cmd.do === 'list-add') {
        const r = await call('lists', 'addToList', { circleId: groupId, list: cmd.list, text: cmd.text });
        say({ step: 'list-added', ok: r?.ok !== false && !r?.error, result: r ?? null });
      } else if (cmd.do === 'lists-dump') {
        // what the peer holds of the circle's lists: every list's name and its open entries' texts
        const lists = (await call('lists', 'listLists', { circleId: groupId }))?.items ?? [];
        const out = [];
        for (const l of lists) {
          const name = l?.label ?? null;
          if (!name) continue;
          const entries = (await call('lists', 'listEntries', { circleId: groupId, list: name }))?.items ?? [];
          out.push({ list: name, id: l?.id ?? null, entries: entries.map((e) => e?.label ?? null).filter(Boolean), ids: Object.fromEntries(entries.filter((e) => e?.label && e?.id).map((e) => [e.label, e.id])) });
        }
        say({ step: 'lists', lists: out });
      } else if (cmd.do === 'tasks-dump') {
        // what the peer holds of the circle's tasks: every open one, its status and who holds it; `me` is the peer's
        // own addresses, so a walk can say "held by Bram" from the peer's own store
        const open = (await call('tasks', 'listOpen', { circleId: groupId }))?.items ?? [];
        say({
          step: 'tasks',
          me: [peer.pubKey, peer.agent.circleSelf?.(groupId)?.webid, peer.agent.circleAddressFor?.(groupId)].filter(Boolean),
          open: open.map((x) => ({ id: x?.id ?? null, text: x?.text ?? null, status: x?.status ?? x?.state ?? null, assignees: Array.isArray(x?.assignees) ? x.assignees : (x?.assignee ? [x.assignee] : []), addedBy: x?.addedBy ?? null })),
        });
      } else if (cmd.do === 'task-claim' || cmd.do === 'task-complete') {
        // the open task whose words hold `text`, claimed or completed through the op a shell's chip calls
        const step = cmd.do === 'task-claim' ? 'task-claimed' : 'task-completed';
        const open = (await call('tasks', 'listOpen', { circleId: groupId, text: cmd.text }))?.items ?? [];
        if (open.length !== 1) { say({ step, ok: false, error: `${open.length} open tasks hold "${cmd.text}"` }); return; }
        const r = await call('tasks', cmd.do === 'task-claim' ? 'claimTask' : 'completeTask', { circleId: groupId, id: open[0].id });
        say({ step, ok: !r?.error && r?.result?.ok !== false, id: open[0].id, result: r ?? null });
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
