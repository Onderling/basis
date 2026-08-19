/**
 * extracted mesh-intro handlers from main.js.
 *
 * Two paired flows for (mesh + consent):
 *
 *   - `propagateMeshIntros` — admin-side.  After a new joiner's
 *     peer-redeem succeeds, admin reads its consenting-member roster
 *     + sends 'circle-peer-intro' envelopes both ways: existing
 *     members → new joiner, and (if the new joiner consented) new
 *     joiner → each existing member.
 *
 *   - `handleCirclePeerIntro` — receiver-side.  When an intro envelope
 *     arrives, write a local membership-redemption (channel='intro')
 *     so the recipient's listGroupRoster picks the peer up for future
 *     /post fan-out.
 *
 * Both are pure-ish: they take `callSkill` + `sendPeer` as deps + log
 * via `logger`.  No DOM, no module-level state.  Easy to unit-test
 * (see test/handlers/meshIntros.test.js).
 */

/**
 * @typedef {object} MeshIntroDeps
 * @property {(appOrigin: string, opId: string, args: object) => Promise<*>} callSkill
 * @property {(addr: string, payload: object) => Promise<*>}                  sendPeer
 * @property {{info?: Function, warn?: Function, error?: Function}}           [logger]
 */

/**
 * @param {MeshIntroDeps} deps
 * @returns {(args: {groupId: string, newPeerAddr: string, newPeerDisplay?: string, newPeerShared?: boolean}) => Promise<{existingCount: number, broadcastedNew: boolean}>}
 */
export function makePropagateMeshIntros({ callSkill, sendPeer, logger = console }) {
  return async function propagateMeshIntros({ groupId, newPeerAddr, newPeerDisplay, newPeerShared }) {
    let consenting = [];
    try {
      const reply = await callSkill('stoop', 'listConsentingPeers', { groupId });
      consenting = reply?.peers ?? [];
    } catch (err) {
      logger.warn?.('[mesh-intro] listConsentingPeers failed', err);
      consenting = [];
    }
    const existing = consenting.filter((p) => p.addr !== newPeerAddr);

    // 1. existing-peer intros → new joiner
    for (const p of existing) {
      try {
        await sendPeer(newPeerAddr, {
          type:        'p2p-chat',
          subtype:     'circle-peer-intro',
          groupId,
          peerAddr:    p.addr,
          peerDisplay: p.display ?? null,
          sentAt:      Date.now(),
        });
      } catch (err) {
        logger.warn?.('[mesh-intro] new-joiner intro failed for', p.addr, err);
      }
    }

    // 2. new joiner's address → existing members (only if they consented)
    if (newPeerShared) {
      for (const p of existing) {
        try {
          await sendPeer(p.addr, {
            type:        'p2p-chat',
            subtype:     'circle-peer-intro',
            groupId,
            peerAddr:    newPeerAddr,
            peerDisplay: newPeerDisplay ?? null,
            sentAt:      Date.now(),
          });
        } catch (err) {
          logger.warn?.('[mesh-intro] existing-peer intro failed for', p.addr, err);
        }
      }
    }

    logger.info?.(`[mesh-intro] propagated for ${groupId}: ${existing.length} existing peer(s)`
      + (newPeerShared ? ' (incl. broadcast of new joiner)' : ' (new joiner opted out)'));
    return { existingCount: existing.length, broadcastedNew: !!newPeerShared };
  };
}

/**
 * @param {{callSkill: MeshIntroDeps['callSkill'], logger?: MeshIntroDeps['logger']}} deps
 * @returns {(fromAddr: string, payload: {groupId: string, peerAddr: string, peerDisplay?: string}) => Promise<{ok: boolean, introId?: string, reason?: string}>}
 */
export function makeHandleCirclePeerIntro({ callSkill, logger = console }) {
  return async function handleCirclePeerIntro(fromAddr, payload) {
    const { groupId, peerAddr, peerDisplay } = payload ?? {};
    if (!groupId || !peerAddr) {
      logger.warn?.('[peer] circle-peer-intro missing fields', payload);
      return { ok: false, reason: 'missing-fields' };
    }
    try {
      const result = await callSkill('stoop', 'recordPeerIntro', {
        groupId, peerAddr, peerDisplay,
      });
      if (result?.error) {
        logger.warn?.('[peer] recordPeerIntro rejected', result.error);
        return { ok: false, reason: result.error };
      }
      logger.info?.(`[peer] mesh-intro: ${peerAddr.slice(0, 16)}… added to ${groupId}`);
      return { ok: true, introId: result?.introId };
    } catch (err) {
      logger.error?.('[peer] handleCirclePeerIntro failed', err);
      return { ok: false, reason: err?.message ?? String(err) };
    }
  };
}
