/**
 * J-SECURITY BREACH SUITE — replay attack.
 * PLAN-real-usage-and-deployment.md §7 ("replay").
 *
 * Scenario 9: capture a valid sealed/signed envelope and re-send it. The
 * kernel `SecurityLayer.decryptAndVerify` must reject the duplicate (msgId
 * dedup) and anything outside the replay window (timestamp).
 *
 * DEFENDED (green):
 *   • a byte-for-byte replayed envelope is rejected as SEC.DUPLICATE.
 *   • an envelope whose _ts is outside the ±10min replay window is rejected
 *     as SEC.REPLAY_WINDOW (both past and future).
 *   • a tampered ciphertext / swapped signer is rejected (BAD_SIG/DECRYPT).
 *
 * DOCUMENTED WINDOW (honest limit): dedup entries expire after DEDUP_TTL_MS
 * (10 min). A replay is only caught while the id is still in the LRU/TTL
 * cache; a capture replayed AFTER the window has already failed the
 * REPLAY_WINDOW timestamp check, so the two guards overlap to close the
 * hole — but a node that restarts (losing the in-memory dedup map) within
 * the replay window would re-accept a still-in-window duplicate. Noted in
 * SECURITY-FINDINGS.
 *
 * Drives the real SecurityLayer — no re-implemented crypto.
 */
import { describe, it, expect } from 'vitest';
import { SecurityLayer, SEC } from '../../src/security/SecurityLayer.js';
import { AgentIdentity }      from '../../src/identity/AgentIdentity.js';
import { VaultMemory }        from '@onderling/vault';
import { mkEnvelope, P }      from '../../src/Envelope.js';

const mkId = () => AgentIdentity.generate(new VaultMemory());

async function pair() {
  const aliceId = await mkId();
  const bobId   = await mkId();
  const aliceSec = new SecurityLayer({ identity: aliceId });
  const bobSec   = new SecurityLayer({ identity: bobId });
  aliceSec.registerPeer(bobId.pubKey, bobId.pubKey);
  bobSec.registerPeer(aliceId.pubKey, aliceId.pubKey);
  return { aliceId, bobId, aliceSec, bobSec };
}

describe('§7.9 — replay attack (dedup + replay window)', () => {
  it('DEFENDED: a byte-for-byte replayed envelope is rejected as DUPLICATE', async () => {
    const { aliceId, bobId, aliceSec, bobSec } = await pair();
    const env = mkEnvelope(P.OW, aliceId.pubKey, bobId.pubKey, { transfer: 100 });
    const enc = aliceSec.encrypt(env);

    // First delivery accepted.
    const dec = bobSec.decryptAndVerify(enc);
    expect(dec.payload).toEqual({ transfer: 100 });

    // Attacker re-sends the identical captured envelope → rejected.
    let code = null;
    try { bobSec.decryptAndVerify(enc); } catch (e) { code = e.code; }
    expect(code).toBe(SEC.DUPLICATE);
  });

  it('DEFENDED: replay with a stale timestamp (past) is rejected as REPLAY_WINDOW', async () => {
    const { aliceId, bobId, aliceSec, bobSec } = await pair();
    // Build an envelope timestamped 20 minutes ago, then sign it so the
    // signature is valid but the timestamp is outside the ±10min window.
    const env = mkEnvelope(P.OW, aliceId.pubKey, bobId.pubKey, { x: 1 });
    env._ts = Date.now() - 20 * 60 * 1000;
    const enc = aliceSec.encrypt(env);   // encrypt re-signs over the stale _ts

    let code = null;
    try { bobSec.decryptAndVerify(enc); } catch (e) { code = e.code; }
    expect(code).toBe(SEC.REPLAY_WINDOW);
  });

  it('DEFENDED: an envelope from the far future is also rejected as REPLAY_WINDOW', async () => {
    const { aliceId, bobId, aliceSec, bobSec } = await pair();
    const env = mkEnvelope(P.OW, aliceId.pubKey, bobId.pubKey, { x: 1 });
    env._ts = Date.now() + 20 * 60 * 1000;
    const enc = aliceSec.encrypt(env);

    let code = null;
    try { bobSec.decryptAndVerify(enc); } catch (e) { code = e.code; }
    expect(code).toBe(SEC.REPLAY_WINDOW);
  });

  it('DEFENDED: a replay with a tampered ciphertext fails signature/decrypt (not silently accepted)', async () => {
    const { aliceId, bobId, aliceSec, bobSec } = await pair();
    const env = mkEnvelope(P.OW, aliceId.pubKey, bobId.pubKey, { transfer: 100 });
    const enc = aliceSec.encrypt(env);

    // Attacker flips a byte in the boxed payload but keeps the id/ts/sig.
    const tampered = { ...enc, payload: { ...enc.payload, _box: enc.payload._box.slice(0, -2) + 'AA' } };
    let threw = false;
    try { bobSec.decryptAndVerify(tampered); } catch { threw = true; }
    expect(threw).toBe(true);   // BAD_SIG (sig covers payload) — never accepted
  });

  it('DEFENDED: a replay re-signed by a DIFFERENT key (impersonation) is rejected', async () => {
    const { aliceId, bobId, bobSec } = await pair();
    const mallory = await mkId();
    const mallorySec = new SecurityLayer({ identity: mallory });
    mallorySec.registerPeer(bobId.pubKey, bobId.pubKey);

    // Mallory captures the SHAPE and re-emits under Alice's _from but signs with her own key.
    // Since Decision 1 the signature verifies — against MALLORY's key, which the envelope now
    // carries — and the envelope is refused one step later instead, because that key is not the one
    // Bob holds for the address it claims. Same outcome, more accurate diagnosis: this was never a
    // forged signature, it was a genuine signature from the wrong person.
    const env = mkEnvelope(P.OW, aliceId.pubKey, bobId.pubKey, { x: 1 });
    const enc = mallorySec.encrypt(env);   // signed by Mallory, _from = Alice
    let code = null;
    try { bobSec.decryptAndVerify(enc); } catch (e) { code = e.code; }
    expect([SEC.SENDER_NOT_BOUND, SEC.BAD_SIG, SEC.DECRYPT_FAILED]).toContain(code);
    expect(code).toBe(SEC.SENDER_NOT_BOUND);
  });
});
