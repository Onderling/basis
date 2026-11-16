/**
 * ATTACHMENTS ON THE PHONE (the function matrix's attachments × mobile cell, M form).
 *
 * Two phones, each its own bundle, wiring and mounted ops (test/support/mobileNode.js), over a real relay.
 *
 * 1. A file into a CONTACT THREAD, end to end: Anna's thread "+" runs the phone's own `send-file` op (mounted by
 *    `mountPhoneAppOps`, the launcher's mount) with the file her picker hands over, then the thread's own settle step
 *    (`settleContactAttach`, as ContactThreadScreen runs it). Bob's phone receives it through its own wiring and stores
 *    it in his thread with her: the SAME bytes, read back from his stored thread.
 * 2. A CIRCLE file is not here, on purpose: a plain circle offers no file entry on the phone (no sealed-media
 *    composition), and in a sealed circle the bytes go to one in-memory bucket per app session, so they cannot reach
 *    another device yet. That half waits on a real (shared) media bucket and is named in the matrix cell.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startJourneyRelay } from '../../basis/test/support/testRelay.js';
import { settleContactAttach } from '../../basis/src/v2/contactAttachOutcome.js';
import { bootMobileNode } from './support/mobileNode.js';

const until = async (pred, ms = 20_000) => {
  const t0 = Date.now();
  while (!(await pred())) {
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => { setTimeout(r, 100); });
  }
  return true;
};
const t = (k) => k;

// a small PNG-like payload: what the phone's document picker returns ({ name, type, size, dataB64 })
const BYTES = Buffer.from(Array.from({ length: 2048 }, (_, i) => (i * 37 + 11) % 256));
const FILE = { name: 'foto.png', type: 'image/png', size: BYTES.length, dataB64: BYTES.toString('base64') };

describe('attachments on the phone — a file into a contact thread crosses to the other phone with its bytes', () => {
  let relay; let anna; let bob;
  beforeAll(async () => {
    relay = await startJourneyRelay();
    anna = await bootMobileNode({ name: 'anna', relayUrl: relay.url });
    bob = await bootMobileNode({ name: 'bob', relayUrl: relay.url });
    // Bob chose Anna (her card in his book): a file from someone he did not choose is refused (a request holds none)
    const card = (await anna.agent.callSkill('pinboard', 'getContactShareQr', {}))?.payload;
    expect((await bob.agent.callSkill('pinboard', 'addContactFromQr', { payload: card }))?.error ?? null).toBe(null);
    // …and Anna holds Bob's card: she writes to someone she chose
    const bobCard = (await bob.agent.callSkill('pinboard', 'getContactShareQr', {}))?.payload;
    expect((await anna.agent.callSkill('pinboard', 'addContactFromQr', { payload: bobCard }))?.error ?? null).toBe(null);
  }, 90_000);
  afterAll(async () => { await anna?.dispose(); await bob?.dispose(); await relay?.close(); });

  it("Anna's thread '+' sends a file; Bob's phone stores the same bytes in his thread with her", async () => {
    // the thread's "+" → the phone's own op, with what the picker returns
    anna.pickNext(FILE);
    const r = await anna.callSkill('basis', 'send-file', { peer: bob.address });
    expect(r?.error ?? null, `send-file refused: ${JSON.stringify(r)}`).toBe(null);
    // …and the thread's settle step: the sent file joins Anna's side of the thread
    const settled = await settleContactAttach(r, { channel: anna.bundle.contactChannel, contactId: bob.address, peerAddr: bob.address, t });
    expect(settled.file, `nothing to settle: ${JSON.stringify(settled)}`).toBeTruthy();

    // Bob's phone: through its own wiring, painted into the thread inbox and stored in his thread with Anna
    expect(await until(() => bob.landed.contactReplies.some((x) => x.file)),
      `Bob's inbox never got a file; landed ${JSON.stringify(bob.landed.contactReplies.map((x) => Object.keys(x)))}, unrouted ${bob.landed.unrouted.length}`).toBe(true);
    let stored = null;
    expect(await until(async () => {
      const turns = await bob.bundle.contactChannel.rehydrate(anna.address);
      stored = turns.find((x) => x.file) ?? null;
      return !!stored;
    }), "the file was painted but never stored in Bob's thread").toBe(true);
    expect(stored.file.name).toBe(FILE.name);
    expect(stored.file.dataB64, 'Bob holds different bytes than Anna sent').toBe(FILE.dataB64);
  }, 60_000);

  it('a pick the person cancels sends nothing', async () => {
    const before = bob.landed.contactReplies.length;
    const r = await anna.callSkill('basis', 'send-file', { peer: bob.address });   // nothing queued = cancel
    expect(r?.ok ?? false, JSON.stringify(r)).toBe(false);
    await new Promise((res) => { setTimeout(res, 1500); });
    expect(bob.landed.contactReplies.length).toBe(before);
  }, 30_000);
});
