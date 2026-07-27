/**
 * basis v2 — carrying asks across the room (Nearby step F, transport half).
 *
 * `nearbyAsks.js` decides what an ask IS and what answering means. This moves them between devices, and it
 * is deliberately a thin seam over an injected `sendTo` rather than anything that knows about mDNS or BLE:
 * the app goes through the surface, never a transport (`CLAUDE.md`), and the peer list it fans out to comes
 * from `createNearbyPeerSource`.
 *
 * ── An inbound ask is UNTRUSTED input ────────────────────────────────────────────────────────────────────
 * This is the first thing in Nearby that accepts a payload from a stranger on the same café Wi-Fi with no
 * prior relationship, no invite and no roster entry. So `receiveAsk` re-validates everything rather than
 * trusting the shape:
 *
 *   • fields are rebuilt, not spread — an attacker cannot smuggle extra keys through into the model;
 *   • text and tag counts are clamped, so a peer cannot push a wall of text into everyone's screen;
 *   • `expiresAt` is capped against OUR clock, so a "never expires" ask cannot pin itself in the room;
 *   • `from` is taken from the WIRE, never from the payload — a sender cannot claim to be someone else.
 *
 * That last one matters most: without it, an ask could name another person's room address and any answer
 * would open a channel to them instead. Cheap to get right here, impossible to fix later.
 */
import { ASK_MAX_TEXT, ASK_MAX_TTL_MS, isAskLive } from './nearbyAsks.js';

/** Message kind on the wire. Namespaced so a room message cannot be confused with app traffic. */
export const ASK_MESSAGE = 'nearby.ask';
export const ANSWER_MESSAGE = 'nearby.answer';

/** A room ask is a shout, not a mailing list — cap the tags so it cannot become a profile. */
export const ASK_MAX_TAGS = 8;

/**
 * @param {object} deps
 * @param {() => object[]} deps.listPeers                   current room peers (from the peer surface)
 * @param {(address: string, payload: object) => Promise<any>} deps.sendTo
 * @param {() => number} [deps.now]
 * @param {(err: Error, phase: string) => void} [deps.onError]
 */
export function createAskChannel({ listPeers = () => [], sendTo, now = () => Date.now(), onError = null } = {}) {
  const report = (err, phase) => { try { onError?.(err, phase); } catch { /* diagnostics only */ } };

  return {
    /**
     * Put an ask into the room.
     *
     * Fans out to everyone currently visible — there is no room server to post to, which is the point. A
     * peer that fails gets counted rather than aborting the rest: reaching most of a café is the normal
     * outcome, not an error state.
     *
     * @returns {Promise<{sent: number, failed: number, peers: number}>}
     */
    async broadcast(ask) {
      if (!ask?.id || !isAskLive(ask, now)) return { sent: 0, failed: 0, peers: 0 };
      return this.broadcastKind(ASK_MESSAGE, { ask });
    },

    /**
     * Fan any room message out to everyone present.
     *
     * `broadcast` above is this with the ask's liveness check; cards and chat (step G) use this directly.
     * One fan-out path rather than one per message kind, so "reaching most of a café is normal, not an
     * error" is decided once.
     *
     * @param {string} kind     the namespaced message kind
     * @param {object} body     the rest of the payload
     */
    async broadcastKind(kind, body) {
      const peers = listPeers() ?? [];
      let sent = 0; let failed = 0;
      for (const peer of peers) {
        const address = peer?.pubKey ?? peer?.id ?? null;
        if (!address || typeof sendTo !== 'function') { failed += 1; continue; }
        try { await sendTo(address, { kind, ...body }); sent += 1; }
        catch (err) { failed += 1; report(err, `broadcast:${kind}`); }
      }
      return { sent, failed, peers: peers.length };
    },

    /**
     * Send an answer to the asker alone.
     *
     * Point-to-point on purpose: the answer is the disclosure, and it discloses to ONE person. Broadcasting
     * it — or copying the room — would tell everyone present who can fix a bike.
     */
    async sendAnswer(answer, toAddress) {
      if (!answer?.askId || !toAddress || typeof sendTo !== 'function') {
        return { ok: false, reason: 'no-recipient' };
      }
      try {
        await sendTo(toAddress, { kind: ANSWER_MESSAGE, answer });
        return { ok: true };
      } catch (err) {
        report(err, 'sendAnswer');
        return { ok: false, reason: err?.message ?? 'send-failed' };
      }
    },

    /**
     * Validate an inbound ask. Returns null for anything that is not a well-formed, live ask.
     *
     * @param {object} payload      the received message
     * @param {string} fromAddress  the address it ACTUALLY arrived from — authoritative
     */
    receiveAsk(payload, fromAddress) {
      if (payload?.kind !== ASK_MESSAGE) return null;
      const raw = payload.ask;
      if (!raw || typeof raw !== 'object') return null;

      const text = typeof raw.text === 'string' ? raw.text.trim() : '';
      if (!text || text.length > ASK_MAX_TEXT) return null;

      const id = typeof raw.id === 'string' && raw.id.length > 0 && raw.id.length <= 128 ? raw.id : null;
      if (!id) return null;

      const at = now();
      const createdAt = typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt) ? raw.createdAt : at;
      // Cap against OUR clock, not theirs. A peer claiming `expiresAt: Infinity` would otherwise pin their
      // ask in every room it reached, forever.
      const claimed = typeof raw.expiresAt === 'number' && Number.isFinite(raw.expiresAt) ? raw.expiresAt : 0;
      const expiresAt = Math.min(claimed, at + ASK_MAX_TTL_MS);
      if (expiresAt <= at) return null;                      // already dead, or dishonestly dated

      const tags = [];
      for (const t of Array.isArray(raw.tags) ? raw.tags : []) {
        const tag = String(t ?? '').trim().toLowerCase();
        if (tag && tag.length <= 64 && !tags.includes(tag)) tags.push(tag);
        if (tags.length >= ASK_MAX_TAGS) break;
      }

      // REBUILT, not spread. Anything the sender added that we do not name here does not exist downstream.
      return Object.freeze({
        id, text, tags: Object.freeze(tags), createdAt, expiresAt,
        // The wire wins. A payload-supplied `from` would let a sender point answers at a third party.
        from: fromAddress ?? null,
      });
    },

    /** Validate an inbound answer, with the same rules. */
    receiveAnswer(payload, fromAddress) {
      if (payload?.kind !== ANSWER_MESSAGE) return null;
      const raw = payload.answer;
      if (!raw || typeof raw !== 'object') return null;

      const text = typeof raw.text === 'string' ? raw.text.trim() : '';
      if (!text || text.length > ASK_MAX_TEXT) return null;
      const askId = typeof raw.askId === 'string' && raw.askId.length > 0 && raw.askId.length <= 128
        ? raw.askId : null;
      if (!askId) return null;

      return Object.freeze({
        askId, text, from: fromAddress ?? null, receivedAt: now(),
        // Rung 3: an answer arriving is what opens the pairwise channel with whoever sent it.
        opensDirectChannel: true,
      });
    },
  };
}
