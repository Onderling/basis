/**
 * Stoop Phase 39 — Picture attachments end-to-end, now SEALED (2026-07-11).
 *
 * The original Phase 39 stored PLAINTEXT bytes in stoop and served them over a
 * chat round-trip. That inline path is REMOVED: basis's per-circle stoop
 * wrapper seals bytes + thumbnail through the circle media gateway and hands
 * stoop an OPAQUE `media` pointer; recipients open it through their own gateway.
 * These tests keep the original INTENT (attach → store → wire → open works; no
 * plaintext leaks; caps/limits enforced) but assert the SEALED shape.
 *
 * Verifies:
 *   - Attachments lib: `validateInboundAttachment` accepts the sealed pointer +
 *     REFUSES inline plaintext; `toBroadcastShape` carries the sealed line, no
 *     local `ref` / `dataB64`; helpers (attachmentPath / freshAttachmentId / caps).
 *   - 39.2: postRequest stores the sealed pointer on `source.attachments`; the
 *           record + broadcast carry NO plaintext bytes / `data:image` thumbnail.
 *   - 39.3: the substrate mirror copies the sealed pointer into mirrored items
 *           (no local `ref`).
 *   - 39.4: the removed plaintext byte-serving path — postRequest REFUSES inline
 *           plaintext; requestAttachment still rejects an unknown item.
 *   - 39.5: sendChatMessage requires body-or-attachment, and REFUSES an inline
 *           plaintext attachment (accepts a sealed pointer).
 *   - Privacy invariant: no plaintext bytes / `data:image` thumbnail crosses the wire.
 *   - Phase 35 interaction: an evicted author's attachment-bearing post is dropped.
 */

import { describe, it, expect } from 'vitest';
import { AgentIdentity, InternalBus, InternalTransport, DataPart } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { createNeighborhoodAgent } from '../src/index.js';
import {
  validateInboundAttachment,
  toBroadcastShape,
  attachmentPath,
  freshAttachmentId,
  MAX_NOTICEBOARD_BYTES_PER_ATT,
  MAX_CHAT_BYTES_PER_ATT,
  MAX_ATTACHMENTS_PER_POST,
} from '../src/lib/Attachments.js';
import { attachSubstrateMirror } from '../src/substrateMirror.js';
import { EVICTION_GRACE_MS } from '../src/lib/EvictionRoster.js';
import { makeSealCircle, makeSealedImageAttachment, TINY_PNG_B64 } from './helpers/sealedAttachment.js';

const ANNE = 'https://id.example/anne';
const BOB  = 'https://id.example/bob';
const TINY_PNG_DATA_URL = `data:image/png;base64,${TINY_PNG_B64}`;

/** The removed inline-plaintext shape — must be REFUSED now. */
function makePlaintextAttachment(extra = {}) {
  return {
    mime: 'image/png', width: 1, height: 1,
    thumbnail: TINY_PNG_DATA_URL, dataB64: TINY_PNG_B64, ...extra,
  };
}

async function buildBundle(actorWebid = ANNE) {
  const id = await AgentIdentity.generate(new VaultMemory());
  const tx = new InternalTransport(new InternalBus(), id.pubKey);
  const bundle = await createNeighborhoodAgent({
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

describe('Phase 39 — Attachments lib (sealed)', () => {
  it('validateInboundAttachment accepts a sealed pointer', async () => {
    const { att } = await makeSealedImageAttachment(makeSealCircle());
    expect(validateInboundAttachment(att)).toBeNull();
  });

  it('REFUSES the removed inline-plaintext shape', () => {
    expect(validateInboundAttachment(makePlaintextAttachment())).toBe('attachment-plaintext-refused');
  });

  it('rejects unsupported mime', async () => {
    const { att } = await makeSealedImageAttachment(makeSealCircle(), { mime: 'image/gif' });
    expect(validateInboundAttachment(att)).toMatch(/mime-not-allowed/);
  });

  it('toBroadcastShape carries the sealed source, strips `ref` and `dataB64`', async () => {
    const { att } = await makeSealedImageAttachment(makeSealCircle());
    const out = toBroadcastShape([{ ...att, ref: 'mem://leaky/path', dataB64: 'OOPS' }]);
    expect(out[0]).not.toHaveProperty('ref');
    expect(out[0]).not.toHaveProperty('dataB64');
    expect(out[0]).not.toHaveProperty('thumbnail');
    expect(out[0].source.type).toBe('blob');
  });

  it('attachmentPath includes the right extension per mime', () => {
    expect(attachmentPath('item-1', 'att-1', 'image/jpeg')).toMatch(/\.jpg$/);
    expect(attachmentPath('item-1', 'att-1', 'image/png')).toMatch(/\.png$/);
    expect(attachmentPath('item-1', 'att-1', 'image/webp')).toMatch(/\.webp$/);
    expect(() => attachmentPath('item-1', 'att-1', 'image/gif')).toThrow();
  });

  it('freshAttachmentId is unique', () => {
    const ids = new Set(Array.from({ length: 50 }, () => freshAttachmentId()));
    expect(ids.size).toBe(50);
  });

  it('size caps are sensible defaults', () => {
    expect(MAX_NOTICEBOARD_BYTES_PER_ATT).toBeGreaterThan(MAX_CHAT_BYTES_PER_ATT);
    expect(MAX_ATTACHMENTS_PER_POST).toBeGreaterThanOrEqual(1);
  });
});

describe('Phase 39.2 — postRequest with sealed attachments', () => {
  it('stores the sealed pointer on source.attachments; no plaintext bytes / thumbnail leak', async () => {
    const { att } = await makeSealedImageAttachment(makeSealCircle());
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'postRequest', {
      text: 'Wie kent een goede fietsenmaker?', kind: 'ask', attachments: [att],
    });
    expect(r.requestId).toBeTruthy();

    const item = await bundle.itemStore.getById(r.requestId);
    const attachments = item?.source?.attachments;
    expect(Array.isArray(attachments)).toBe(true);
    expect(attachments.length).toBe(1);
    expect(attachments[0].source.type).toBe('blob');
    expect(attachments[0].source.enc.sealed).toBe(true);
    // Bytes / plaintext thumbnail never leak onto the item record.
    expect(attachments[0]).not.toHaveProperty('dataB64');
    const serialized = JSON.stringify(item);
    expect(serialized).not.toContain('data:image');
    expect(serialized).not.toContain(TINY_PNG_B64);
  });

  it('REFUSES an inline-plaintext attachment', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'postRequest', {
      text: 'plaintext', kind: 'ask', attachments: [makePlaintextAttachment()],
    });
    expect(r.error).toBe('attachment-plaintext-refused');
  });

  it('rejects too many attachments', async () => {
    const circle = makeSealCircle();
    const tooMany = await Promise.all(
      Array.from({ length: MAX_ATTACHMENTS_PER_POST + 1 }, () => makeSealedImageAttachment(circle).then((x) => x.att)),
    );
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'postRequest', {
      text: 'too many', kind: 'ask', attachments: tooMany,
    });
    expect(r.error).toMatch(/attachments-too-many/);
  });
});

describe('Phase 39.3 — substrate mirror copies the sealed pointer', () => {
  it('mirror() carries the sealed attachment (no local `ref`)', async () => {
    const { att } = await makeSealedImageAttachment(makeSealCircle(), { createdBy: BOB });
    const bundle = await buildBundle();
    const mirror = await attachSubstrateMirror(bundle, {
      group:          'oosterpoort',
      peers:          [],
      evictionRoster: bundle.evictionRoster,
    });

    await mirror.backfillFrom('pubkey-bob-stub', [{
      id:           'broadcast-from-bob-1',
      addedBy:      BOB,
      type:         'request',
      text:         'Bob has a thing',
      requiredSkills: [],
      source: { skillTags: [], categoryId: null, attachments: [att] },
    }]);

    const open = await bundle.itemStore.listOpen();
    const mirrored = open.find(i => i?.source?.requestId === 'broadcast-from-bob-1');
    expect(mirrored).toBeTruthy();
    const atts = mirrored.source?.attachments ?? [];
    expect(atts.length).toBe(1);
    expect(atts[0].source.type).toBe('blob');
    expect(atts[0].ref).toBeUndefined();   // no local cache path on a mirror

    await mirror.stop();
  });
});

describe('Phase 39.4 — plaintext byte-serving path removed', () => {
  it('postRequest refuses inline plaintext (no bytes are persisted to serve)', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'postRequest', {
      text: 'self-attachment', kind: 'ask', attachments: [makePlaintextAttachment()],
    });
    expect(r.error).toBe('attachment-plaintext-refused');
  });

  it('requestAttachment still rejects an unknown item', async () => {
    const bundle = await buildBundle();
    expect(await callSkill(bundle.agent, 'requestAttachment', { itemId: 'nope', attId: 'x' }))
      .toEqual({ error: 'item-not-found' });
  });
});

describe('Phase 39.5 — sendChatMessage with a sealed attachment', () => {
  it('rejects empty body + no attachment', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'sendChatMessage', { threadId: 't1', toWebid: BOB });
    expect(r.error).toBe('body-or-attachment-required');
  });

  it('REFUSES an inline-plaintext chat attachment', async () => {
    const bundle = await buildBundle();
    const r = await callSkill(bundle.agent, 'sendChatMessage', {
      threadId: 't1', toWebid: BOB, attachment: makePlaintextAttachment(),
    });
    expect(r.error).toBe('attachment-plaintext-refused');
  });
});

describe('Phase 35 + 39 interaction — evicted authors still drop attachments', () => {
  it('evicted member with attachment: nothing lands locally', async () => {
    const { att } = await makeSealedImageAttachment(makeSealCircle(), { createdBy: BOB });
    const bundle = await buildBundle();
    const past = Date.now() - EVICTION_GRACE_MS - 60_000;
    bundle.evictionRoster.applyRedemption({
      type: 'membership-redemption',
      source: { redeemedBy: BOB, expiresAt: past },
    });

    const mirror = await attachSubstrateMirror(bundle, {
      group:          'oosterpoort',
      peers:          [],
      evictionRoster: bundle.evictionRoster,
    });

    await mirror.backfillFrom('pubkey-bob-stub', [{
      id:           'evicted-with-pic',
      addedBy:      BOB,
      type:         'request',
      text:         'evicted post',
      requiredSkills: [],
      source: { attachments: [att] },
    }]);

    const open = await bundle.itemStore.listOpen();
    expect(open.some(i => i?.source?.requestId === 'evicted-with-pic')).toBe(false);
    await mirror.stop();
  });
});
