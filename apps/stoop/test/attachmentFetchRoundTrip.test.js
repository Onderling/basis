/**
 * Recipient attachment round-trip — now SEALED (2026-07-11).
 *
 * Original intent (S6.5): a recipient holding only an attachment's thumbnail
 * gets the full image. The original mechanism — a plaintext `attachment-request`
 * / `attachment-response` chat round-trip served by the author — was superseded
 * by the sealed path below and removed on 2026-10-07 (stoop is key-agnostic
 * and never holds plaintext bytes to serve).
 *
 * The sealed replacement preserves the intent: the SEALED inline thumbnail
 * travels ON the pointer, and the full sealed blob lives in the circle media
 * gateway's bucket. A recipient in the same circle (same content key) opens BOTH
 * through its own gateway — no author round-trip, no plaintext on the wire.
 */
import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { openBlob, openThumbnail } from '@onderling/blob-gateway';
import { createNeighbourhoodAgent } from '../src/index.js';
import { makeSealCircle, makeSealedImageAttachment, TINY_PNG_B64 } from './helpers/sealedAttachment.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';

async function buildBundle({ bus = new InternalBus(), actor = ANNE } = {}) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const bundle = await createNeighbourhoodAgent({
    identity: id,
    transport: new InternalTransport(bus, id.pubKey),
    offeringMatch: { group: 'oosterpoort', localActor: actor, peers: [] },
    members: [{ webid: actor }],
  });
  await bundle.offeringMatch.start();
  bundle.pubKey = id.pubKey;
  return bundle;
}

describe('sealed recipient round-trip — open the sealed pointer through the circle gateway', () => {
  it('a recipient opens the sealed thumbnail + full blob to the original bytes; no plaintext on the received item', async () => {
    // ONE circle key: Anne seals the image; Bob (same circle) has the same content key.
    const circle = makeSealCircle();
    const { att, plaintextBytes } = await makeSealedImageAttachment(circle, { createdBy: ANNE });

    const bob = await buildBundle({ actor: BOB });
    // Bob mirrors Anne's post carrying ONLY the opaque sealed pointer (no bytes, no local ref).
    const [mirrored] = await bob.itemStore.addItems([{
      type: 'request', text: 'wie heeft een ladder?', visibility: 'household',
      source: { fromPubKey: 'pubkey-anne', broadcast: true, attachments: [att] },
    }], { actor: 'pubkey-anne' });

    const stored = mirrored.source.attachments[0];
    // No plaintext bytes / data:image thumbnail ever reached Bob's store.
    const serialized = JSON.stringify(mirrored);
    expect(serialized).not.toContain('data:image');
    expect(serialized).not.toContain(TINY_PNG_B64);
    expect(stored).not.toHaveProperty('dataB64');
    expect(stored.ref).toBeUndefined();

    // Sealed inline thumbnail opens with NO gate / NO fetch (it ships on the line).
    const thumbBytes = openThumbnail({ line: stored.source, opener: circle.opener });
    expect(thumbBytes.length).toBeGreaterThan(0);

    // Full sealed blob opens THROUGH the circle gateway, byte-for-byte.
    const opened = await openBlob({
      ref: stored.source, gate: circle.gate, token: 't', opener: circle.opener, fetch: circle.fetchImpl,
    });
    expect(Array.from(opened.bytes)).toEqual(Array.from(plaintextBytes));

    await bob.close?.();
  });
});
