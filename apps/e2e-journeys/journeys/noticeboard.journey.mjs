// J-circle: the real stoop neighbourhood flow over the relay — host creates a
// circle + invite code, a stranger joins (admin-verified), host posts to the
// prikbord, the stranger sees it, replies, and that spins a private 1:1 chat.
import { AgentIdentity, DataPart } from '@onderling/core';
import { VaultMemory }             from '@onderling/vault';
import { Reveals }                 from '@onderling/identity-resolver';
import { RelayTransport }          from '@onderling/transports';
import { createNeighborhoodAgent, attachSubstrateMirror } from '@onderling-app/stoop';
import { wait, checker }           from './_util.mjs';

export const name = 'J-circle (join → prikbord → private chat)';

export async function run({ relayUrl }) {
  const { results, check } = checker();
  const GROUP = 'e2e-circle', HOST = 'https://id.example/anne', STRANGER = 'https://id.example/bob';

  const hostId     = await AgentIdentity.generate(new VaultMemory());
  const strangerId = await AgentIdentity.generate(new VaultMemory());
  const mk = (id, me, peer, peerWebid) => createNeighborhoodAgent({
    identity: id, transport: new RelayTransport({ relayUrl, identity: id }),
    offeringMatch: { group: GROUP, localActor: me, peers: [{ pubKey: peer.pubKey }] },
    members: [
      { webid: me,        stableId: id.stableId,   pubKey: id.pubKey },
      { webid: peerWebid, stableId: peer.stableId, pubKey: peer.pubKey },
    ],
    reveals: new Reveals(),
  });
  const host     = await mk(hostId, HOST, strangerId, STRANGER);
  const stranger = await mk(strangerId, STRANGER, hostId, HOST);
  host.agent.addPeer(strangerId.pubKey, strangerId.pubKey);
  stranger.agent.addPeer(hostId.pubKey, hostId.pubKey);
  await attachSubstrateMirror(host,     { group: GROUP, peers: [{ pubKey: strangerId.pubKey }] });
  await attachSubstrateMirror(stranger, { group: GROUP, peers: [{ pubKey: hostId.pubKey }] });
  await host.offeringMatch.start();
  await stranger.offeringMatch.start();
  const call = (b, op, args, from) =>
    b.agent.skills.get(op).handler({ parts: args === undefined ? [] : [DataPart(args)], from, agent: b.agent, envelope: null });

  try {
    await wait(2500);
    check('host + stranger on the relay',
      host.agent.transport.connected && stranger.agent.transport.connected);

    const created = await call(host, 'createGroupV2', { groupId: GROUP, name: 'Circle Oosterpoort', rules: {} }, HOST);
    check('host created circle + invite code', typeof created?.code === 'string' && created.code.length > 0);
    await wait(1200);

    // The invite code travels out-of-band (QR); the admin verifies it against
    // the code it holds, then the joiner mirrors the confirmed redemption.
    const v = await call(host, 'verifyMembershipCodeForPeer', { groupId: GROUP, code: created.code, requesterWebid: STRANGER }, HOST);
    let m;
    if (v?.redemptionId) {
      m = await call(stranger, 'recordRemoteRedemption',
        { groupId: GROUP, code: created.code, codeId: v.codeId, expiresAt: v.validUntil, confirmedBy: HOST }, STRANGER);
    }
    check('stranger joined via admin-verified invite code', !!v?.redemptionId && !!m?.redemptionId);
    await wait(700);

    const posted = await call(host, 'postRequest', { text: 'Iemand een boormachine te leen?', intent: 'ask' }, HOST);
    check('host posted to the prikbord', !!(posted?.item?.id ?? posted?.id ?? posted?.requestId));
    await wait(1800);

    const openItems = await stranger.itemStore.listOpen({});
    const seenPost = openItems.find((i) => i.source?.broadcast) ?? openItems.find((i) => i.text?.includes('boormachine'));
    check('stranger sees the prikbord post (mirror over relay)', !!seenPost);

    let reply;
    if (seenPost) {
      reply = await call(stranger, 'respondToItem',
        { itemId: seenPost.source?.requestId ?? seenPost.id, body: 'Ik heb er een, kom maar langs!' }, STRANGER);
    }
    check('reply spins a private 1:1 thread', !!reply?.threadId);
    await wait(1800);

    let thread = { messages: [] };
    if (reply?.threadId) { try { thread = await call(host, 'getChatThread', { threadId: reply.threadId }, HOST); } catch { /* */ } }
    check('host receives the reply privately (1:1 over relay)',
      (thread.messages ?? []).some((x) => (x.body ?? x.text ?? '').includes('kom maar langs')));

    // ── removal (the coupling fix, live): the admin bans the stranger → dropped from the mesh ──
    const inBefore = !!(await host.members?.resolveByWebid?.(STRANGER));
    const removal = await call(host, 'removeMember', { groupId: GROUP, memberWebid: STRANGER, policy: 'ban' }, HOST);
    check('admin removes the stranger (ban) → recorded + revoked',
      !!removal?.removalId && removal?.revoked === true && removal?.policy === 'ban');
    const inAfter = !!(await host.members?.resolveByWebid?.(STRANGER));
    check('the removed member is dropped from the MemberMap (fan-out stops targeting them)', inBefore && !inAfter);
  } finally {
    for (const b of [host, stranger]) await b.agent.transport.disconnect().catch(() => {});
  }
  return results;
}
