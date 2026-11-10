/**
 * A STALE VERDICT: "I cannot vouch for this sender YET". The authorizer port answers allow, refuse, or stale (with an
 * opaque bucket the kernel does not interpret). On stale the SecurityLayer refuses with SENDER_STALE and the bucket,
 * and RELEASES the envelope's dedup entry, so the same verified envelope can be judged again once the authorizer's
 * snapshot is fresher (the host holds it meanwhile). The kernel stays blind to what the bucket is.
 */
import { describe, it, expect } from 'vitest';
import { SecurityLayer, SEC } from '../../src/security/SecurityLayer.js';
import { allowSender, staleSender, askSenderAuthorizer } from '../../src/security/senderAuthorization.js';
import { AgentIdentity } from '../../src/identity/AgentIdentity.js';
import { VaultMemory } from '@onderling/vault';
import { mkEnvelope, P } from '../../src/Envelope.js';

const newIdentity = () => AgentIdentity.generate(new VaultMemory());

describe('a stale verdict', () => {
  it('the port keeps stale and its bucket through normalisation', () => {
    const v = askSenderAuthorizer(() => staleSender('roster-not-read', 'circle-x'), {});
    expect(v).toEqual({ allow: false, stale: true, reason: 'roster-not-read', bucket: 'circle-x' });
  });

  it('refuses with SENDER_STALE and the bucket, and the same envelope is judged again once the answer changes', async () => {
    const meId = await newIdentity();
    const me = new SecurityLayer({ identity: meId });
    const ours = await newIdentity();
    me.addSelfIdentity('me-in-circle', ours);
    let fresh = false;
    me.setSenderAuthorizer(({ ownAddress }) => (ownAddress && !fresh ? staleSender('roster-not-read', 'circle-x') : allowSender('member')));

    const senderId = await newIdentity();
    const sender = new SecurityLayer({ identity: senderId });
    sender.registerPeer(ours.pubKey, ours.pubKey);
    me.registerPeer(senderId.pubKey, senderId.pubKey);
    const env = sender.encrypt(mkEnvelope(P.OW, senderId.pubKey, ours.pubKey, { subtype: 'chat', text: 'hoi' }));

    let caught = null;
    try { me.decryptAndVerify(env); } catch (err) { caught = err; }
    expect(caught?.code).toBe(SEC.SENDER_STALE);
    expect(caught?.bucket).toBe('circle-x');

    fresh = true;
    const opened = me.decryptAndVerify(env);   // NOT a duplicate: the stale refusal released its dedup entry
    expect(opened.payload).toMatchObject({ subtype: 'chat', text: 'hoi' });
  });
});
