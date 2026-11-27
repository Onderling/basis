/**
 * SILENT out-of-circle delivery (mobile) — the RECEIVE + STORE + LIST + OPEN wiring, end-to-end with REAL crypto.
 *
 * Proves the mobile receiver the shell wires: an inbound `shared-copy` envelope routed to `makeHandleSharedCopy`
 * lands the sealed copy in the TIERED per-user store (`makeSharedWithMeStoreRN` over a mock AsyncStorage), and
 * the launcher's view (the SAME shared `buildSharedWithMe` / `openSharedCopy` selector web uses) lists it and
 * opens it with THIS device's own network-derived opener (`openerForIdentity` over a real `AgentIdentity`). No
 * cipher mocks: real pod-client sealing, real item-store, real AgentIdentity — web≡mobile via the shared src.
 */
import { describe, it, expect } from 'vitest';
import { groupKeyStrategy } from '@onderling/pod-client';
import { setShellContentSeal } from '../../basis/src/v2/localStoreSeal.js';
// the store seals at rest (ledger L1083): a content key is published, as after a boot
setShellContentSeal(groupKeyStrategy({ groupKey: Buffer.from(new Uint8Array(32).fill(7)).toString('base64url') }));
import { AgentIdentity } from '@onderling/core';
import { VaultMemory } from '@onderling/vault';
import { recipientStrategy, sealingPublicKeyFromNetworkKey } from '@onderling/pod-client/sealing';
import { sealItem } from '@onderling/item-store';
import { buildSharedWithMe, openSharedCopy, makeHandleSharedCopy, openerForIdentity } from '@onderling-app/basis';
import { makeSharedWithMeStoreRN } from '../src/core/circleStoresRN.js';

function mockAsyncStorage() {
  const m = new Map();
  return {
    map: m,
    async getItem(k)    { return m.has(k) ? m.get(k) : null; },
    async setItem(k, v) { m.set(k, String(v)); },
    async removeItem(k) { m.delete(k); },
  };
}

/** SENDER side — seal a copy to the recipient's network-derived sealing key (the shell's silent-share path). */
async function sealCopyToNetworkKey(item, recipientNetworkKeyB64) {
  const sealKey = sealingPublicKeyFromNetworkKey(recipientNetworkKeyB64);
  return sealItem(item, (text) => recipientStrategy({ recipients: [sealKey] }).seal(text));
}

describe('mobile shared-copy receiver — handler persists into the RN store; the view lists + opens it', () => {
  it('routes an inbound shared-copy into the AsyncStorage-backed store, then lists + opens it (REAL crypto)', async () => {
    const storage = mockAsyncStorage();
    const store   = makeSharedWithMeStoreRN(storage);   // local-only (no pod writer) — the device-canonical tier

    // A recipient identity on THIS device; a peer sealed a copy to its published network key.
    const recipient = await AgentIdentity.generate(new VaultMemory());
    const sealed = await sealCopyToNetworkKey(
      { id: 'copy-9', type: 'note', text: 'gedeelde notitie' },
      recipient.pubKey,
    );

    // The receive handler the mobile peer router registers under subtype 'shared-copy'.
    let renderedRows = null;
    const handle = makeHandleSharedCopy({ store, onReceived: (rows) => { renderedRows = rows; } });

    // Deliver the relayed envelope (peer address, payload) — the handler is fire-and-forget internally.
    handle('peer-alice-addr', {
      subtype: 'shared-copy',
      sealed,
      itemMeta: { copyId: 'copy-9', sourceType: 'note', silent: true },
      from: 'alice',
    });
    // Flush the handler's async store.add → onReceived.
    await new Promise((r) => setTimeout(r, 0));

    // PERSISTED: the store read-back (and AsyncStorage under the web-parity key) holds the copy.
    const list = await store.list();
    expect(list.map((e) => e.id)).toEqual(['copy-9']);
    expect(renderedRows?.map((e) => e.id)).toEqual(['copy-9']);
    expect(storage.map.has('basis.sharedWithMe')).toBe(true);

    // VIEW: the launcher projects with the SHARED selector, then opens with this device's OWN opener.
    const rows = buildSharedWithMe(list);
    expect(rows[0]).toMatchObject({ id: 'copy-9', from: 'alice', sourceType: 'note' });

    const opener = openerForIdentity(recipient);
    expect(typeof opener).toBe('function');
    const opened = await openSharedCopy(rows[0], opener);
    expect(opened.text).toBe('gedeelde notitie');

    // DENY-SAFE: a stranger's opener never yields plaintext.
    const stranger = await AgentIdentity.generate(new VaultMemory());
    await expect(openSharedCopy(rows[0], openerForIdentity(stranger))).rejects.toBeTruthy();
  });

  it('dedupes a redelivered copy (idempotent store.add)', async () => {
    const store = makeSharedWithMeStoreRN(mockAsyncStorage());
    const recipient = await AgentIdentity.generate(new VaultMemory());
    const sealed = await sealCopyToNetworkKey({ id: 'copy-1', type: 'note', text: 'x' }, recipient.pubKey);
    const handle = makeHandleSharedCopy({ store });
    const env = { subtype: 'shared-copy', sealed, itemMeta: { copyId: 'copy-1' }, from: 'alice' };
    handle('addr', env);
    await new Promise((r) => setTimeout(r, 0));
    handle('addr', env);   // redelivery
    await new Promise((r) => setTimeout(r, 0));
    expect((await store.list()).map((e) => e.id)).toEqual(['copy-1']);
  });
});
