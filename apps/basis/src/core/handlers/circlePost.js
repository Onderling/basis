import { notifyIfResonant } from './driverMatchNotify.js';

/**
 * Inbound circle-post handler. Bundle H Phase 2 — lifted from
 * `apps/basis/web/main.js:807` (2026-05-24).
 *
 * Ingests a peer's fan-out post into the local stoop substrate via
 * `stoop.ingestRemotePost`.  Handles dedup + eviction-filter inside
 * the skill; we just publish a notification on success.
 *
 * The NKN sender address is recorded alongside `fromPubKey` so
 * [Help with] / row-button actions can route a follow-up back over
 * the wire to the original poster.
 *
 * @param {object} args
 * @param {(appOrigin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {(event: object) => void}                                        [args.publishEvent]
 * @param {() => Promise<Record<string,object>>} [args.getDrivers]  loads the user's drivers (for match→notify); defaults to getProfileDrivers on the default persona
 * @param {string} [args.personaId='default']  the persona whose drivers match the feed
 * @param {{info?, warn?, error?}}                                         [args.logger]
 * @returns {(fromAddr: string, envelope: object) => Promise<void>}
 */
export function makeHandleCirclePost({
  callSkill, publishEvent, getDrivers, personaId = 'default', logger = console,
} = {}) {
  if (typeof callSkill !== 'function') throw new Error('makeHandleCirclePost: callSkill required');
  // Drivers #5 — load MY private drivers on-device to match incoming posts (default: the default persona).
  const loadDrivers = typeof getDrivers === 'function'
    ? getDrivers
    : async () => (await callSkill('agents', 'getProfileDrivers', { id: personaId }))?.drivers ?? {};

  return async function handleCirclePost(fromAddr, envelope) {
    const { groupId, fromPubKey, payload } = envelope ?? {};
    logger.info?.('[peer] circle-post received: groupId=' + groupId
      + ' from=' + String(fromAddr).slice(0, 16) + '… requestId=' + payload?.requestId);
    if (!payload?.requestId) {
      logger.warn?.('[peer] circle-post missing payload.requestId', envelope);
      return;
    }
    let result;
    try {
      result = await callSkill('stoop', 'ingestRemotePost', {
        payload,
        fromPubKey:  fromPubKey ?? fromAddr,
        fromPeerAddr: fromAddr,
      });
    } catch (err) {
      logger.error?.('[peer] handleCirclePost failed', err);
      return;
    }
    if (result?.error) {
      logger.warn?.('[peer] ingestRemotePost rejected', result.error, payload.requestId);
      return;
    }
    if (result?.deduped) {
      logger.info?.('[peer] circle-post deduped (already have requestId=' + payload.requestId + ')');
      return;
    }
    if (result?.evicted) {
      logger.info?.('[peer] circle-post from evicted member dropped', payload.from);
      return;
    }
    logger.info?.('[peer] circle-post ingested: new itemId=' + result?.itemId);
    publishEvent?.({
      app:   'stoop',
      type:  'notification',
      actor: payload.from ?? fromAddr,
      payload: {
        message: `📥 ${payload.kind ?? payload.type ?? 'post'} in ${groupId ?? 'circle'}: ${payload.text ?? '(no text)'}`,
        ...(payload.requestId ? { postId: payload.requestId } : {}),
        ...(groupId           ? { groupId }                   : {}),
      },
    });

    // Drivers #5 — does this post resonate with MY private drivers? Match on-device (the drivers never
    // leave this device) and, on an explainable match, fire a SEPARATE resonance nudge. Best-effort:
    // the signature is the post's driverSignature if it carries one, else its text/tags (fallback), so
    // this already works on the existing feed. The user reaching out is their follow-up (existing channel).
    try {
      await notifyIfResonant({
        item: { ...payload, id: result?.itemId ?? payload.requestId, title: payload.text },
        getDrivers: loadDrivers,
        notify: (p) => publishEvent?.({
          app: 'stoop', type: 'notification', actor: payload.from ?? fromAddr,
          payload: {
            message: p.message,
            driverMatch: true,
            topReason: p.topReason,
            ...(payload.requestId ? { postId: payload.requestId } : {}),
            ...(groupId           ? { groupId }                   : {}),
          },
        }),
      });
    } catch (err) { logger.warn?.('[peer] driver match→notify skipped', err); }
  };
}
