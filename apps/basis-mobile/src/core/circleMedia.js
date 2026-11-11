/**
 * The phone's per-circle sealed-media composition — moved out of CircleLauncherScreen's module level, unchanged, so
 * every caller (the launcher, the noticeboard wrapper, the picture resolvers, the Node phone in tests) reaches ONE.
 *
 * Mirror of web circleApp.js: ONE DEV bucket per app session (in-memory; the real S3/R2 swap point is recorded in
 * circleMediaGateway.js), and the per-circle composition cached so the session ACL's grants persist across re-opens.
 * A circle with no seal strategy (a plain, pod-less circle) composes to `null` → sealed-only: the wrapper refuses
 * attachments and the "+" offers no file entry (NO unsealed fallback). The bucket being per session means a circle
 * file's BYTES do not reach another device yet; the pointer does.
 */
import { createCircleMediaComposition, makeDevMediaBucket } from '../../../basis/src/v2/circleMediaGateway.js';
import { getCircleSealStrategy, getCircleActorWebId } from './circlePods.js';
import { resolveSealedThumbUri } from './mijHost.js';

/** The session's one media bucket — the circles' compositions and the person's own (the launcher's self media). */
export const circleMediaBucket = makeDevMediaBucket();
const circleMediaCompositions = new Map();   // circleId → Promise<composition|null>
// One circle's picture opener, bound lazily (web parity: circleApp's `circlePictureResolver`). A roster row's picture
// is sealed to ITS circle, a contact's to the pair circle — so a paint site names the circle and gets the opener here.
// Cached per circle so a FaceView's `resolvePicture` keeps its identity across renders.
const circlePictureResolvers = new Map();

/** The circle's picture resolver (a sealed thumbnail ref → a data: URI), or null without a circle id. */
export function circlePictureResolver(circleId, policy) {
  if (typeof circleId !== 'string' || !circleId) return null;
  if (!circlePictureResolvers.has(circleId)) {
    circlePictureResolvers.set(circleId, async (ref) => {
      const comp = await getCircleMediaComposition(circleId, policy).catch(() => null);
      return resolveSealedThumbUri(ref, comp?.mediaGateway?.opener);
    });
  }
  return circlePictureResolvers.get(circleId);
}

/** The circle's sealed-media composition (`{ mediaGateway, … }`), or null when the circle cannot seal. */
export function getCircleMediaComposition(circleId, policy) {
  if (!circleId) return Promise.resolve(null);
  if (!circleMediaCompositions.has(circleId)) {
    circleMediaCompositions.set(circleId, createCircleMediaComposition({
      circleId,
      getSealStrategy: () => getCircleSealStrategy(circleId, policy),
      localActor: getCircleActorWebId() || 'me',
      bucket: circleMediaBucket,
    }).catch(() => null).then((c) => {
      // "none" is not kept: a policy that arrives later (the circle's posture on the governance lane) may make this
      // circle able to seal, and the next ask should find out rather than reuse the old answer.
      if (!c) circleMediaCompositions.delete(circleId);
      return c;
    }));
  }
  return circleMediaCompositions.get(circleId);
}
