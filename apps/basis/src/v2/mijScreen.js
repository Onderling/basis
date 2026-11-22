/**
 * Mij = identity: the PERSONA PANEL behind the persona button, ONE declared short view. The manifest lists its blocks
 * (`meBlocks` — the identity line, the agents list); this fills them through the one screen materializer, over every circle the person is in. Each shell paints
 * the result with its own block painter, below the declared Me actions — no shell lists a section of Me by hand.
 */
import { basisManifest } from '../../manifest.js';
import { materializeScreen } from './userScreenBlocks.js';

export { availabilityWords, agentRowWords } from './mijWords.js';

/** The declared Mij blocks, each with a stable id. */
export function mijBlocks(manifest = basisManifest) {
  return (Array.isArray(manifest?.meBlocks) ? manifest.meBlocks : [])
    .map((b, i) => ({ id: `mij-${b.type}-${i}`, type: b.type, config: { ...(b.config ?? {}) } }));
}

/**
 * Vandaag's top (above "Nieuw voor jou"): the declared `todayBlocks` ("Wacht op jou"), each
 * with a stable id. The materializer fills them when the shell asks for Vandaag's top (`hostOps.todayTop`).
 */
export function todayTopBlocks(manifest = basisManifest) {
  return (Array.isArray(manifest?.todayBlocks) ? manifest.todayBlocks : [])
    .map((b, i) => ({ id: `today-${b.type}-${i}`, type: b.type, config: { ...(b.config ?? {}) } }));
}

/**
 * Materialize Me's blocks.
 * @param {object} a
 * @param {object} a.hostOps   the shell's sources: `callSkill`, `circles`, `eventLog`, `seenAt`, `myRefs`, `selfIn(circleId)`
 *   (who "mine" is in each circle — a persona's circle is the persona's),
 *   and for the agents block `deviceId` (this device)
 * @returns {Promise<Array<object>>}
 */
export async function mijScreenBlocks({ hostOps = {} } = {}) {
  const screen = { id: 'mij', name: '', circleFilter: null, blocks: mijBlocks() };
  return materializeScreen({ screen, hostOps });
}

