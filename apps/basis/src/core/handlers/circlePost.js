import { notifyIfResonant } from './driverMatchNotify.js';

/**
 * A circle post from another member that arrived on this device for the first time: announce it. The post itself is
 * already in the circle's store (the lane put it there, verified against the roster); this publishes the notification
 * and runs the on-device driver match, so a post that resonates with this self's drivers says why.
 *
 * @param {object} args
 * @param {(appOrigin: string, opId: string, args: object) => Promise<*>} args.callSkill
 * @param {(event: object) => void}                                        [args.publishEvent]
 * @param {() => Promise<Record<string,object>>} [args.getDrivers]  loads the user's drivers (for match→notify); defaults to getProfileDrivers on the default persona
 * @param {string} [args.personaId='default']  the persona whose drivers match a post outside any known circle
 * @param {(circleId: string) => string} [args.profileIdOf]  the self this device is in a circle (a persona's circle is
 *   the persona's) — a post resonates with THAT self's drivers; absent = `personaId` throughout
 * @param {{info?, warn?, error?}}                                         [args.logger]
 * @returns {(fromAddr: string, envelope: object) => Promise<void>}
 */
export function makeHandleCirclePost({
  callSkill, publishEvent, getDrivers, personaId = 'default', profileIdOf = null, logger = console,
} = {}) {
  if (typeof callSkill !== 'function') throw new Error('makeHandleCirclePost: callSkill required');
  // Drivers #5 — load MY private drivers on-device to match incoming posts (default: the default persona).
  // …of the self this device is in the post's circle (the device acts as that circle's self)
  const selfFor = (groupId) => (groupId && typeof profileIdOf === 'function' ? (profileIdOf(groupId) ?? personaId) : personaId);
  const loadDrivers = typeof getDrivers === 'function'
    ? getDrivers
    : async (groupId) => (await callSkill('agents', 'getProfileDrivers', { id: selfFor(groupId) }))?.drivers ?? {};

  return async function handleCirclePost(fromAddr, envelope) {
    const { groupId, fromPubKey, payload } = envelope ?? {};
    logger.info?.('[peer] circle-post received: groupId=' + groupId
      + ' from=' + String(fromAddr).slice(0, 16) + '… requestId=' + payload?.requestId);
    if (!payload?.requestId) {
      logger.warn?.('[peer] circle-post missing payload.requestId', envelope);
      return;
    }
    // the post is already in the circle's store (the lane put it there, verified against the roster): announce it
    const result = { itemId: payload.requestId };
    publishEvent?.({
      app:   'pinboard',
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
        getDrivers: () => loadDrivers(groupId),
        notify: (p) => publishEvent?.({
          app: 'pinboard', type: 'notification', actor: payload.from ?? fromAddr,
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
