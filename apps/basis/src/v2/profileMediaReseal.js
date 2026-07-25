/**
 * Profile-picture seal path (SHARED — web ≡ mobile by construction).
 *
 * The picture's SOURCE OF TRUTH is sealed to the OWNER themselves — a media
 * composition whose content strategy seals to my own network-derived sealing
 * key and opens with my identity's self-opener. So the source is owner-openable
 * and circle-INDEPENDENT. On disclosure to a circle the source is RE-SEALED into
 * a private per-circle copy (Frits: option (a)): each circle a picture is shared
 * to gets its OWN copy under its OWN key — a member of X can never open Y's copy,
 * and no cross-circle key ever crosses. The plaintext is transient + client-side.
 *
 * Both shells (web circleApp.js, mobile CircleLauncherScreen.js) inject their own
 * identity + media bucket + per-circle composition getter; the reseal LOGIC lives
 * here once (invariants 1 + 3), never copied into a shell.
 */
import { createCircleMediaComposition } from './circleMediaGateway.js';
import { recipientStrategy, sealingPublicKeyFromNetworkKey } from '@onderling/pod-client';
import { openerForIdentity } from './sharedCopyOpener.js';
import { openBlob, uploadBlob, openThumbnail } from '@onderling/blob-gateway';
import { isSealedMediaRef } from '@onderling/agent-registry';

/**
 * Build the OWNER-sealed source composition (circleId `'self'`): content sealed to
 * my own network-derived sealing key, opened with my identity's self-opener. Returns
 * null when identity/keys are unavailable (the picker then simply doesn't render).
 * @param {{identity: {pubKey?: string}, bucket: object, localActor: string}} args
 */
export async function buildSelfMediaComposition({ identity, bucket, localActor }) {
  const netPub = identity?.pubKey;
  const opener = openerForIdentity(identity);
  if (!netPub || typeof opener !== 'function') return null;
  let sealPub = null;
  try { sealPub = sealingPublicKeyFromNetworkKey(netPub); } catch { sealPub = null; }
  if (!sealPub) return null;
  const selfStrategy = { seal: recipientStrategy({ recipients: [sealPub] }).seal, open: opener };
  try {
    return await createCircleMediaComposition({
      circleId: 'self', getSealStrategy: () => selfStrategy, localActor, bucket,
    });
  } catch { return null; }
}

/**
 * Re-seal ONE self-sealed media ref to a circle (option (a)): open the source via my
 * self-opener → bytes → seal + upload (full image + inline thumbnail) through THAT
 * circle's media gateway → the circle-sealed manifest line. Null on any failure — the
 * caller then DROPS the prop rather than leak the un-openable source ref.
 * @param {{ref: object, selfComposition: object, circleComposition: object}} args
 */
export async function resealMediaRefForCircle({ ref, selfComposition, circleComposition }) {
  const selfGw = selfComposition?.mediaGateway;
  const gw = circleComposition?.mediaGateway;
  if (!selfGw || typeof selfGw.opener !== 'function') return null;
  if (!gw?.bucket || typeof gw.sealer !== 'function') return null;
  // Open the full image bytes from the self-sealed source line.
  const bytes = await openBlob({ ref, gate: selfGw.gate, token: selfGw.token, opener: selfGw.opener });
  if (!bytes) return null;
  // Re-seal the inline thumbnail too, with the circle's sealer.
  let thumbBytes = null;
  try { thumbBytes = openThumbnail({ line: ref, opener: selfGw.opener }); } catch { thumbBytes = null; }
  const media = (ref && ref.enc)
    ? { mime: ref.enc.mime, width: ref.enc.width, height: ref.enc.height, thumbnail: thumbBytes }
    : undefined;
  return await uploadBlob({ bytes, bucket: gw.bucket, sealer: gw.sealer, keyRef: gw.keyRef, media });
}

/**
 * The `resealMediaForCircle` injected into shareDisclosureToCircle. Given a release +
 * the target circle, return a COPY whose media props (any self-sealed media ref) are
 * re-sealed to that circle; non-media props pass through untouched; a media prop whose
 * re-seal FAILS is dropped from the outbound copy (never leaked as the source ref).
 * The SOURCE object is left intact — the caller keeps it for the diff-gate/memo, so an
 * unchanged picture is still a no-op.
 * @param {{getSelfComposition: () => Promise<object|null>,
 *          getCircleComposition: (circleId: string, policy: object) => Promise<object|null>,
 *          getPolicy?: (circleId: string) => Promise<object|null>}} deps
 */
export function makeResealMediaForCircle({ getSelfComposition, getCircleComposition, getPolicy }) {
  return async function resealMediaForCircle(props, circleId) {
    if (!props || typeof props !== 'object') return props;
    const mediaKeys = Object.keys(props).filter((k) => isSealedMediaRef(props[k]));
    if (mediaKeys.length === 0) return props;
    const selfComposition = await getSelfComposition().catch(() => null);
    let policy = null;
    if (typeof getPolicy === 'function') { try { policy = await getPolicy(circleId); } catch { /* defaults */ } }
    const circleComposition = await getCircleComposition(circleId, policy).catch(() => null);
    const out = { ...props };
    for (const k of mediaKeys) {
      const resealed = await resealMediaRefForCircle({ ref: props[k], selfComposition, circleComposition }).catch(() => null);
      if (resealed) out[k] = resealed; else delete out[k];
    }
    return out;
  };
}
