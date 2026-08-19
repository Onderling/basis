/**
 * J-SECURITY BREACH SUITE — sealed-content confidentiality + hostile relay.
 * PLAN-real-usage-and-deployment.md §7.
 *
 * Scenarios:
 *   4. A circle member tries to read content NOT sealed to them (wrong key /
 *      not a recipient) → MUST fail to open.                        (DEFENDED)
 *   6. A hostile relay handling a sealed forward sees only ciphertext,
 *      and cannot forge the sender. What it CAN do (metadata, drop,
 *      reorder) is asserted + documented honestly.                  (DEFENDED + noted)
 *
 * Drives the real kernel sealing (`AgentIdentity.box/unbox`, `packSealed`/
 * `openSealed`) — no re-implemented crypto. Mirrors `relayReceiveSealed.test.js`.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity } from '../../src/identity/AgentIdentity.js';
import { VaultMemory }   from '@onderling/vault';
import { packSealed, openSealed } from '../../src/security/sealedForward.js';
import { TextPart }      from '../../src/Parts.js';
import { signOrigin }    from '../../src/security/originSignature.js';

const mkId = () => AgentIdentity.generate(new VaultMemory());

describe('§7.4 — malicious member reads OTHERS\' sealed content', () => {
  it('DEFENDED: a peer NOT addressed by the seal cannot open it (nacl.box auth fails)', async () => {
    const alice   = await mkId();
    const bob     = await mkId();   // the intended recipient
    const mallory = await mkId();   // a circle member, but NOT this message's recipient

    // Alice seals a per-recipient message to Bob.
    const { nonce, ciphertext } = alice.box(new TextEncoder().encode('for Bob only'), bob.pubKey);

    // Bob opens it.
    const forBob = bob.unbox(ciphertext, nonce, alice.pubKey);
    expect(new TextDecoder().decode(forBob)).toBe('for Bob only');

    // Mallory, though a member of the same circle, is not a recipient →
    // nacl.box.open returns null (authentication failure), never plaintext.
    const forMallory = mallory.unbox(ciphertext, nonce, alice.pubKey);
    expect(forMallory).toBeNull();
  });

  it('DEFENDED: ciphertext carries no plaintext of the secret', async () => {
    const alice = await mkId();
    const bob   = await mkId();
    const { ciphertext } = alice.box(new TextEncoder().encode('TOPSECRET-XYZ'), bob.pubKey);
    const asText = Buffer.from(ciphertext).toString('binary');
    expect(asText).not.toContain('TOPSECRET-XYZ');
  });

  it('DEFENDED: a sealed skill-forward (packSealed) opens ONLY with the target\'s key', async () => {
    const alice   = await mkId();
    const carol   = await mkId();   // target
    const mallory = await mkId();   // eavesdropper

    const parts = [TextPart('sealed to carol')];
    const { sig, originTs } = signOrigin(alice, { target: carol.pubKey, skill: 'receive-message', parts });
    const { sealed, nonce } = packSealed({
      identity: alice, recipientPubKey: carol.pubKey, skill: 'receive-message',
      parts, origin: alice.pubKey, originSig: sig, originTs,
    });

    // Carol opens it.
    const opened = openSealed({ identity: carol, sealed, nonce, senderPubKey: alice.pubKey });
    expect(opened.skill).toBe('receive-message');

    // Mallory cannot — she is not the recipient.
    expect(() => openSealed({ identity: mallory, sealed, nonce, senderPubKey: alice.pubKey }))
      .toThrow(/authentication failed/);
  });
});

describe('§7.6 — hostile relay: confidentiality holds, sender unforgeable', () => {
  it('DEFENDED: the relay (Bob) sees only opaque ciphertext, never the plaintext parts', async () => {
    const alice = await mkId();
    const carol = await mkId();

    const parts = [TextPart('hidden-from-relay-CANARY')];
    const { sig, originTs } = signOrigin(alice, { target: carol.pubKey, skill: 'receive-message', parts });
    const { sealed, nonce } = packSealed({
      identity: alice, recipientPubKey: carol.pubKey, skill: 'receive-message',
      parts, origin: alice.pubKey, originSig: sig, originTs,
    });

    // Everything the relay handles is `{ sealed, nonce }` — scan it for the canary.
    const whatRelaySees = JSON.stringify({ targetPubKey: carol.pubKey, sealed, nonce });
    expect(whatRelaySees).not.toContain('hidden-from-relay-CANARY');
    // But the target recovers it.
    expect(openSealed({ identity: carol, sealed, nonce, senderPubKey: alice.pubKey }).parts[0].text)
      .toBe('hidden-from-relay-CANARY');
  });

  it('DEFENDED: a hostile relay cannot swap the sender (origin ≠ claimed sender is caught)', async () => {
    const alice = await mkId();
    const bob   = await mkId();   // hostile relay
    const carol = await mkId();

    const parts = [TextPart('secret')];
    const { sig, originTs } = signOrigin(alice, { target: carol.pubKey, skill: 'receive-message', parts });
    const { sealed, nonce } = packSealed({
      identity: alice, recipientPubKey: carol.pubKey, skill: 'receive-message',
      parts, origin: alice.pubKey, originSig: sig, originTs,
    });

    // Bob (relay) claims HE is the sender when handing the seal to Carol.
    // nacl.box was keyed to (Alice→Carol); opening with senderPubKey=Bob fails.
    expect(() => openSealed({ identity: carol, sealed, nonce, senderPubKey: bob.pubKey }))
      .toThrow(/authentication failed/);
  });

  it('NOTED (honest limit): a hostile relay CAN observe metadata + drop/delay', async () => {
    // This test documents what a hostile relay legitimately CAN do, so the
    // audit is honest: it forwards opaque envelopes, so it necessarily learns
    // WHO talks to WHOM (target pubKey is plaintext for routing), timing, and
    // message sizes; and being the transport, it can DROP or REORDER messages.
    // Confidentiality + integrity of CONTENT hold (asserted above); metadata
    // privacy + delivery-guarantee do NOT. There is no cover traffic / padding /
    // mix layer today — a documented, accepted property, not a code bug.
    const alice = await mkId();
    const carol = await mkId();
    const parts = [TextPart('x')];
    const { sig, originTs } = signOrigin(alice, { target: carol.pubKey, skill: 'm', parts });
    const { sealed, nonce } = packSealed({
      identity: alice, recipientPubKey: carol.pubKey, skill: 'm',
      parts, origin: alice.pubKey, originSig: sig, originTs,
    });
    const wire = { targetPubKey: carol.pubKey, sealed, nonce };
    // The routing target IS visible to the relay (this is the metadata leak).
    expect(wire.targetPubKey).toBe(carol.pubKey);
    // (Drop/reorder are inherent to any relay holding the transport; not asserted
    //  as a defence because there is none — see SECURITY-FINDINGS.)
  });
});
