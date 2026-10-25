// M2 durable sealed inbox: a companion node on the relay holds SEALED messages
// for an away owner; deposit + drain travel over the relay; the node holds only
// ciphertext; only the owner key drains + opens.
import { Agent, AgentIdentity, Parts, DataPart } from '@onderling/core';
import { VaultMemory }                from '@onderling/vault';
import { RelayTransport }             from '@onderling/transports';
import { seal, open, generateKeypair } from '@onderling/pod-client/sealing';
import { startCompanionNode }         from '@onderling-app/companion-node';
import { rm }      from 'node:fs/promises';
import { tmpdir }  from 'node:os';
import { join }    from 'node:path';
import { wait, checker } from './_util.mjs';

export const name = 'sealed inbox (M2 durable hold)';

export async function run({ relayUrl }) {
  const { results, check } = checker();
  const cfg = join(tmpdir(), `e2e-m2-${process.pid}-${results.length}-${Math.floor(Math.random() * 1e6)}`);
  const annId = await AgentIdentity.generate(new VaultMemory());
  const bobId = await AgentIdentity.generate(new VaultMemory());
  const ann = new Agent({ identity: annId, transport: new RelayTransport({ relayUrl, identity: annId }) });
  const bob = new Agent({ identity: bobId, transport: new RelayTransport({ relayUrl, identity: bobId }) });
  const bobSeal = generateKeypair();

  const node = await startCompanionNode({ vaultPassphrase: 'test-only-passphrase',
    relayUrl, configDir: cfg, gate: false, inbox: true, inboxOwnerPubKey: bob.address,
  });
  const C = node.agent.address;
  ann.addPeer(C, C); node.agent.addPeer(ann.address, ann.address);
  bob.addPeer(C, C); node.agent.addPeer(bob.address, bob.address);
  const invoke = async (from, op, data) =>
    Parts.data(await from.invoke(C, op, [DataPart(data ?? {})], { timeout: 9000 }));

  try {
    await ann.start(); await bob.start(); await wait(1800);
    check('Ann, Bob, companion all on the relay',
      ann.transport.connected && bob.transport.connected && node.agent.transport.connected);

    const bad = await invoke(ann, 'inbox.deposit', { sealed: 'plain text', topic: 'dm' });
    check('deposit refuses a non-sealed payload', bad?.ok === false && bad?.error === 'not-sealed');

    const msgs = ['de sleutel ligt onder de mat', 'bel me om 20:00'];
    let cnt = 0;
    for (const m of msgs) {
      const r = await invoke(ann, 'inbox.deposit', { sealed: seal(m, [bobSeal.publicKey]), topic: 'dm' });
      if (r?.ok) cnt = r.count;
    }
    check('two sealed deposits accepted + held', cnt === 2);

    const annDrain = await invoke(ann, 'inbox.drain', {});
    check('non-owner drain forbidden', annDrain?.ok === false && annDrain?.error === 'forbidden');

    const atRest = JSON.stringify(await node.inbox.store.snapshot());
    check('no plaintext at rest (sealed envelopes only)',
      !atRest.includes('sleutel') && !atRest.includes('20:00') && atRest.includes('fp1:'));

    const drain = await invoke(bob, 'inbox.drain', {});
    check('owner drains 2 items + contentless digest',
      drain?.ok === true && drain.items?.length === 2 && drain.digest?.count === 2);

    let opened = [];
    try { opened = drain.items.map((m) => open(m.sealed, bobSeal.privateKey)); } catch { /* */ }
    check('only owner opens → originals in order', JSON.stringify(opened) === JSON.stringify(msgs));

    const c = await invoke(bob, 'inbox.count', {});
    check('inbox empty after drain', c?.ok === true && c.count === 0);
  } finally {
    await ann.transport.disconnect().catch(() => {});
    await bob.transport.disconnect().catch(() => {});
    await node.stop?.().catch?.(() => {});
    await rm(cfg, { recursive: true, force: true }).catch(() => {});
  }
  return results;
}
