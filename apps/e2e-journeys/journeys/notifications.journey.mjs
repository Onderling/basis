// J-notifications: the reliable-wake nudge. A message for an away device fires a
// CONTENTLESS wake (no sender, no content — the OS/push provider learns nothing),
// reliably enough to wake a force-killed iOS app; the device then RECONNECTS and
// PULLS the sealed content itself. A burst yields ONE wake (M1 batching).
//
// Uses the REAL companion wake path (startCompanionNode's inboxWakeSender) with a
// ReliableExpoPushSender over a recording fetch — so we inspect the exact push
// body that would hit Expo/APNs, without a real push service.
import { Agent, AgentIdentity, Parts, DataPart } from '@onderling/core';
import { VaultMemory }                 from '@onderling/vault';
import { RelayTransport }              from '@onderling/transports';
import { ReliableExpoPushSender }      from '@onderling/relay';
import { seal, open, generateKeypair } from '@onderling/pod-client/sealing';
import { startCompanionNode }          from '../../companion-node/src/index.js';
import { rm }     from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join }   from 'node:path';
import { wait, checker } from './_util.mjs';

export const name = 'J-notifications (contentless wake → pull sealed)';

export async function run({ relayUrl }) {
  const { results, check } = checker();
  const cfg = join(tmpdir(), `e2e-notif-${process.pid}-${Math.floor(Math.random() * 1e6)}`);

  // Recording fetch: captures every push body the wake sender would POST to Expo.
  const wakeBodies = [];
  const recordingFetch = async (_url, init) => {
    try { wakeBodies.push(JSON.parse(init.body)); } catch { /* */ }
    return { ok: true, status: 200, statusText: 'OK', text: async () => '{}', json: async () => ({ data: { status: 'ok' } }) };
  };
  const wakeSender = new ReliableExpoPushSender({ fetch: recordingFetch });   // the RELIABLE path

  const annId = await AgentIdentity.generate(new VaultMemory());
  const bobId = await AgentIdentity.generate(new VaultMemory());
  const ann = new Agent({ identity: annId, transport: new RelayTransport({ relayUrl, identity: annId }) });
  const bob = new Agent({ identity: bobId, transport: new RelayTransport({ relayUrl, identity: bobId }) });
  const bobSeal = generateKeypair();

  const node = await startCompanionNode({ vaultPassphrase: 'test-only-passphrase',
    relayUrl, configDir: cfg, gate: false,
    inbox: true, inboxOwnerPubKey: bob.address,
    inboxWakeSender: wakeSender, inboxWakeToken: 'tok-bob', inboxWakePlatform: 'ios',
    inboxThrottleMs: 10_000,     // batch a burst into ONE wake (M1)
  });
  const C = node.agent.address;
  ann.addPeer(C, C); node.agent.addPeer(ann.address, ann.address);
  bob.addPeer(C, C); node.agent.addPeer(bob.address, bob.address);
  const invoke = async (from, op, data) => Parts.data(await from.invoke(C, op, [DataPart(data ?? {})], { timeout: 9000 }));

  const secrets = ['vertrouwelijk: rekeningnummer NL12', 'geheim overleg om 21:00', 'code rood'];
  try {
    await ann.start(); await bob.start(); await wait(1800);
    check('Ann, Bob, companion (with waker) on the relay',
      ann.transport.connected && bob.transport.connected && node.agent.transport.connected);

    // Bob is "away": Ann deposits three sealed messages in a burst.
    for (const s of secrets) await invoke(ann, 'inbox.deposit', { sealed: seal(s, [bobSeal.publicKey]), topic: 'dm' });
    await wait(800);

    // ── the WAKE: exactly one, reliable, contentless, leaking nothing ──────────
    check('a burst of 3 deposits yields exactly ONE wake (M1 batching)', wakeBodies.length === 1, `wakes=${wakeBodies.length}`);
    const wake = wakeBodies[0] ?? {};
    check('the wake is RELIABLE (mutable-content → wakes a force-killed iOS app)', wake.mutableContent === true);
    check('the wake is CONTENTLESS (data = {wake, hint:"message-pending"}, not silent-only)',
      JSON.stringify(wake.data) === JSON.stringify({ wake: true, hint: 'message-pending' }) && wake._contentAvailable === undefined);
    const wireBlob = JSON.stringify(wake);
    check('the wake leaks NO sender identity and NO message plaintext',
      !wireBlob.includes(ann.address) && !/vertrouwelijk|geheim|rekeningnummer|NL12|21:00|rood/.test(wireBlob));

    // ── the device wakes, PULLS the sealed content itself, and opens it ────────
    const drain = await invoke(bob, 'inbox.drain', {});
    const opened = (drain?.items ?? []).map((m) => { try { return open(m.sealed, bobSeal.privateKey); } catch { return null; } });
    check('device pulls sealed content on wake → all 3 messages recovered, in order',
      drain?.ok === true && JSON.stringify(opened) === JSON.stringify(secrets), `digest=${JSON.stringify(drain?.digest)}`);
  } finally {
    await ann.transport.disconnect().catch(() => {});
    await bob.transport.disconnect().catch(() => {});
    await node.stop?.().catch?.(() => {});
    await rm(cfg, { recursive: true, force: true }).catch(() => {});
  }
  return results;
}
