/**
 * mij#personas — the MOBILE host wiring behind the "Mij → persona's" surface.
 *
 * Portable twin of web's `openAboutMePanel` op sequence (apps/basis/web/v2/
 * circleApp.js): listAgents (role 'profile') → getProfileProperties /
 * getProfileDisclosure per persona → getPersonaRelease per enabled context →
 * `buildMijViewModel` (the SHARED read-model, apps/basis/src/v2/personaView.js
 * — web ≡ mobile by construction). The RN screen (CircleMijScreen) renders the
 * model and calls the op helpers below; NO model logic lives in the screen.
 *
 * Kept out of `src/screens/` on purpose: vitest excludes RN screens, so this
 * module is where the mobile half of the wiring is testable (test/mijHost.test.js),
 * matching the other mobile logic-level screen tests.
 *
 * All ops ride the injected 3-arg `callSkill(origin, opId, args)` — the same
 * bridge every v2 screen uses; reads re-run after each edit so the surface
 * reflects the PERSISTED state (verify the result, not the dispatch).
 */
// Relative paths (not `@onderling-app/basis` subpaths) — Metro doesn't honour
// package.json "exports" subpaths (same pattern as hostOps.js). The loader
// itself is the SHARED one (phase-D consolidation): web and mobile run the
// identical sequence by construction; pass `activeCircleId` to also run the
// marker-guarded roster-skills migration for that circle.
export { loadMijModel } from '../../../basis/src/v2/mijLoader.js';
export { shareDisclosureToCircle } from '../../../basis/src/core/handlers/personaPropsUpdate.js';

/** Section-1 edit — set a charter property on the GENERAL persona (the truth layer). */
export async function setGeneralProperty({ callSkill, defaultId, key, value }) {
  try { await callSkill('agents', 'setProfileProperty', { id: defaultId ?? 'default', key, value }); } catch { /* */ }
}

/** The shared offering key derivation — keyed by the phrase; re-using it edits. */
export { offeringKeyFor } from '../../../basis/src/core/offeringsMigration.js';
import { offeringKeyFor as sharedOfferingKeyFor } from '../../../basis/src/core/offeringsMigration.js';

/** Offerings — add an offering-kind driver ({text, tags}) to the GENERAL persona. */
export async function addGeneralOffering({ callSkill, defaultId, text, tags }) {
  const key = sharedOfferingKeyFor({ text, tags });
  try { await callSkill('agents', 'setProfileDriver', { id: defaultId ?? 'default', key, kind: 'offering', text, tags }); } catch { /* */ }
}

/** Section-2 add-affordance — create a new persona (createProfile). */
export async function createPersona({ callSkill, name }) {
  try { await callSkill('agents', 'createProfile', { id: name }); } catch { /* */ }
}

/** Section-3 toggle — enable/withdraw one key's disclosure for a circle. */
export async function toggleDisclosure({ callSkill, personaId, defaultId, contextId, key, enabled }) {
  try { await callSkill('agents', 'setProfileDisclosure', { id: personaId ?? (defaultId ?? 'default'), contextId, key, enabled }); } catch { /* */ }
}

// ── Profile picture (media persona attribute) — the SET/read/preview wiring ──
// The picker/encode/seal seam is INJECTED by the launcher (the shell owns platform
// UI + the self-sealed media gateway); the op SEQUENCE lives here (web ≡ mobile: the
// web shell runs the identical createMediaEmbed → setProfileProperty). The picture is
// sealed to the OWNER'S OWN key (the self composition) — never a circle — so it is the
// GENERAL persona's truth layer; the per-circle re-seal happens later on disclosure
// (shareDisclosureToCircle's resealMediaForCircle — profileMediaReseal.js).
import { createMediaEmbed } from '../../../basis/src/core/handlers/mediaEmbed.js';
import { openThumbnail } from '@onderling/blob-gateway';
import { bytesToStdB64 } from './mediaCardModel.js';

/**
 * Open the picker, seal the chosen image to the OWNER'S media gateway, and record it as
 * the general persona's `profilePicture`. Returns `{ok, source}` — `{ok:false}` on a
 * cancelled pick, a missing gateway (a sealed-only p0/p1 self comp), or a failed op.
 * @param {{callSkill:Function, defaultId?:string, mediaGateway:object,
 *          openFilePicker:Function, encodeImage?:Function, localActor?:string, t:Function}} a
 */
export async function setProfilePicture({ callSkill, defaultId, mediaGateway, openFilePicker, encodeImage, localActor, t }) {
  if (!mediaGateway || typeof openFilePicker !== 'function') return { ok: false };
  let embed;
  try {
    embed = await createMediaEmbed({}, { openFilePicker, mediaGateway, encodeImage, localActor, t });
  } catch { return { ok: false }; }
  const source = (embed && embed.ok !== false) ? (embed.snapshot?.source ?? null) : null;
  if (!source) return { ok: false };                       // cancelled pick or encode/seal failure
  try {
    await callSkill('agents', 'setProfileProperty', { id: defaultId ?? 'default', key: 'profilePicture', value: source });
  } catch { return { ok: false }; }
  return { ok: true, source };
}

/** Read the general persona's current `profilePicture` ref (null when unset). */
export async function loadCurrentPicture({ callSkill, defaultId }) {
  try {
    const props = (await callSkill('agents', 'getProfileProperties', { id: defaultId ?? 'default' }))?.properties ?? {};
    const entry = props.profilePicture;
    return (entry && typeof entry === 'object' && entry.value !== undefined) ? entry.value : (entry ?? null);
  } catch { return null; }
}

/**
 * Sealed picture ref → a `data:` URI for RN `<Image source={{uri}}>` (RN has no
 * object-URLs). Opens the inline sealed thumbnail with the owner's self-opener; null on
 * a wrong key / missing thumb / absent opener (the preview then shows its placeholder).
 * @param {object} ref                  the sealed media manifest line ({type,ref,enc})
 * @param {(sealedText:string)=>string} opener
 */
export function resolveSealedThumbUri(ref, opener) {
  if (!ref || typeof opener !== 'function') return null;
  try {
    const bytes = openThumbnail({ ref, opener });
    if (!bytes || bytes.length === 0) return null;
    const mime = (ref.enc && ref.enc.mime) || 'image/jpeg';
    return `data:${mime};base64,${bytesToStdB64(bytes)}`;
  } catch { return null; }
}
