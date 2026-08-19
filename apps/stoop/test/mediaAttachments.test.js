/**
 * Sealed media (2026-07-11) — stoop attachments are OPAQUE, per-circle SEALED
 * `media` pointers.
 *
 * (Was: "media consolidation" shape guards over a PLAINTEXT `dataB64` +
 * `data:image` thumbnail path. That inline path is REMOVED — stoop is now
 * key-agnostic: basis's per-circle stoop wrapper seals bytes + thumbnail
 * through the circle media gateway and hands stoop only the manifest-line
 * pointer. These tests keep the ORIGINAL intent — attach → store → wire → open
 * works, and no plaintext leaks — but assert the SEALED shape.)
 *
 * Guards (against the REAL `@onderling/item-types` schema + `@onderling/blob-gateway`):
 *   - `validateInboundAttachment` ACCEPTS the sealed pointer and REFUSES the old
 *     inline `dataB64` / `data:image` thumbnail (the removed plaintext path).
 *   - `persistInboundAttachment` returns a schema-valid `media` item that carries
 *     the opaque blob `source` (with `enc.sealed`) and NO plaintext / local ref.
 *   - `toWireShape` output is schema-valid, carries the sealed `source.enc`
 *     (so a recipient can open it) and no `dataB64` / `data:` thumbnail / local ref.
 *   - End-to-end: postRequest stores the sealed pointer; the sealed inline
 *     thumbnail + full blob open (openThumbnail / openBlob) round-trip to the
 *     original bytes.
 */

import { describe, it, expect } from 'vitest';
import { validate } from '@onderling/item-types';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { openBlob, openThumbnail } from '@onderling/blob-gateway';
import { isSealed } from '@onderling/pod-client/sealing';
import { createNeighbourhoodAgent } from '../src/index.js';
import {
  persistInboundAttachment,
  validateInboundAttachment,
  toWireShape,
  toBroadcastShape,
} from '../src/lib/Attachments.js';
import { makeSealCircle, makeSealedImageAttachment, TINY_PNG_B64 } from './helpers/sealedAttachment.js';

const ANNE = 'https://id.example/anne';

/** The removed inline-plaintext shape — must be REFUSED now. */
function makePlaintextInbound(extra = {}) {
  return {
    mime: 'image/png', width: 1, height: 1,
    thumbnail: `data:image/png;base64,${TINY_PNG_B64}`,
    dataB64: TINY_PNG_B64,
    ...extra,
  };
}

async function buildBundle(actorWebid = ANNE) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighbourhoodAgent({
    identity:   id,
    transport:  tx,
    offeringMatch: { group: 'oosterpoort', localActor: actorWebid, peers: [] },
    members:    [{ webid: actorWebid }],
  });
  await bundle.offeringMatch.start();
  return bundle;
}

async function callSkill(agent, skillId, args, asWebid = ANNE) {
  const def = agent.skills.get(skillId);
  if (!def) throw new Error(`callSkill: no such skill: ${skillId}`);
  return def.handler({
    parts:    args === undefined ? [] : [DataPart(args)],
    from:     asWebid,
    agent,
    envelope: null,
  });
}

describe('sealed media — validateInboundAttachment', () => {
  it('accepts a sealed media pointer', async () => {
    const circle = makeSealCircle();
    const { att } = await makeSealedImageAttachment(circle);
    expect(validateInboundAttachment(att)).toBeNull();
  });

  it('REFUSES the removed inline-plaintext shape (dataB64 + data:image thumbnail)', () => {
    expect(validateInboundAttachment(makePlaintextInbound())).toBe('attachment-plaintext-refused');
    expect(validateInboundAttachment(makePlaintextInbound({ dataB64: undefined })))
      .toBe('attachment-plaintext-thumbnail-refused');
  });

  it('rejects a non-sealed / non-blob source', () => {
    expect(validateInboundAttachment({ type: 'media', source: { type: 'stoop-att', ref: 'stoop-att://x/y' }, mime: 'image/png' }))
      .toBe('attachment-not-sealed-blob');
  });
});

describe('sealed media — persistInboundAttachment emits a schema-valid sealed media item', () => {
  it('carries the opaque blob source (sealed), no plaintext / local ref', async () => {
    const circle = makeSealCircle();
    const { att } = await makeSealedImageAttachment(circle);
    const rec = await persistInboundAttachment({ att, actor: ANNE });

    const check = validate(rec);
    expect(check.ok, JSON.stringify(check.errors)).toBe(true);
    expect(rec.type).toBe('media');
    expect(rec.createdBy).toBe(ANNE);
    expect(rec.source.type).toBe('blob');
    expect(rec.source.ref.startsWith('blob://')).toBe(true);
    expect(rec.source.enc.sealed).toBe(true);
    // The inline thumbnail rides the manifest line SEALED (never plaintext).
    expect(isSealed(rec.source.enc.thumb)).toBe(true);
    // No plaintext / local-only fields survive.
    expect(rec).not.toHaveProperty('dataB64');
    expect(rec).not.toHaveProperty('ref');
    expect(rec).not.toHaveProperty('thumbnail');
  });
});

describe('sealed media — toWireShape', () => {
  it('carries the sealed source.enc, no plaintext / local ref', async () => {
    const circle = makeSealCircle();
    const { att } = await makeSealedImageAttachment(circle);
    const rec = await persistInboundAttachment({ att, actor: ANNE });
    const wire = toWireShape(rec);

    expect(wire).not.toHaveProperty('ref');
    expect(wire).not.toHaveProperty('dataB64');
    expect(wire).not.toHaveProperty('thumbnail');   // no plaintext data:image on the wire
    const check = validate(wire);
    expect(check.ok, JSON.stringify(check.errors)).toBe(true);
    expect(wire.source.type).toBe('blob');
    expect(isSealed(wire.source.enc.thumb)).toBe(true);   // sealed thumb travels — openable by peers
  });

  it('broadcast shape == wire shape for every sealed media item', async () => {
    const circle = makeSealCircle();
    const { att } = await makeSealedImageAttachment(circle);
    const rec = await persistInboundAttachment({ att, actor: ANNE });
    expect(toBroadcastShape([rec])).toEqual([toWireShape(rec)]);
  });
});

describe('sealed media — attachment flow round-trip', () => {
  it('postRequest stores the sealed pointer; thumbnail + full blob open to the original bytes', async () => {
    const circle = makeSealCircle();
    const { att, plaintextBytes } = await makeSealedImageAttachment(circle);

    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'postRequest', {
      text: 'Wie wil deze foto zien?', kind: 'ask', attachments: [att],
    });
    expect(r.requestId).toBeTruthy();

    const item = await bundle.itemStore.getById(r.requestId);
    const stored = item.source.attachments[0];
    // Stored shape is the OPAQUE sealed pointer — no plaintext anywhere in the record.
    const check = validate(stored);
    expect(check.ok, JSON.stringify(check.errors)).toBe(true);
    expect(stored.source.type).toBe('blob');
    expect(JSON.stringify(item)).not.toContain('data:image');
    expect(JSON.stringify(item)).not.toContain(TINY_PNG_B64);   // raw plaintext bytes absent

    // Round-trip: open the sealed inline thumbnail (no gate/fetch) …
    const thumbBytes = openThumbnail({ line: stored.source, opener: circle.opener });
    expect(thumbBytes.length).toBeGreaterThan(0);
    // … and the full sealed blob through the gate.
    const opened = await openBlob({
      ref: stored.source, gate: circle.gate, token: 't', opener: circle.opener, fetch: circle.fetchImpl,
    });
    expect(Array.from(opened.bytes)).toEqual(Array.from(plaintextBytes));
  });
});

describe('sealed media — per-circle (no cross-seal)', () => {
  it('an image sealed in circle A does NOT open with circle B\'s opener', async () => {
    const circleA = makeSealCircle();
    const circleB = makeSealCircle();
    const { att } = await makeSealedImageAttachment(circleA);
    // Wrong key: the thumbnail is a valid sealed envelope but B cannot unseal it.
    expect(() => openThumbnail({ line: att.source, opener: circleB.opener })).toThrow();
    await expect(openBlob({
      ref: att.source, gate: circleA.gate, token: 't', opener: circleB.opener, fetch: circleA.fetchImpl,
    })).rejects.toThrow();
  });
});
