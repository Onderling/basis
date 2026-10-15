/**
 * Mij = identity: ONE declared screen. The manifest lists its blocks (`meBlocks` — the identity line, the agents
 * list); this fills them through the one screen materializer, over every circle the person is in. Each shell paints
 * the result with its own block painter, below the declared Me actions — no shell lists a section of Me by hand.
 */
import { basisManifest } from '../../manifest.js';
import { materializeScreen, MIJ_READINGS } from './userScreenBlocks.js';

export { MIJ_READINGS };
export { identityLineWords, agentRowWords } from './mijWords.js';

/** The declared Mij blocks, each with a stable id. */
export function mijBlocks(manifest = basisManifest) {
  return (Array.isArray(manifest?.meBlocks) ? manifest.meBlocks : [])
    .map((b, i) => ({ id: `mij-${b.type}-${i}`, type: b.type, config: { ...(b.config ?? {}) } }));
}

/**
 * Materialize Me's blocks.
 * @param {object} a
 * @param {object} a.hostOps   the shell's sources: `callSkill`, `circles`, `eventLog`, `seenAt`, `myRefs`, `myWebid`,
 *   and for the identity line `availability` (the stored record) and `online` (this device reached its relays), for
 *   the agents block `deviceId` (this device)
 * @returns {Promise<Array<object>>}
 */
export async function mijScreenBlocks({ hostOps = {} } = {}) {
  const screen = { id: 'mij', name: '', circleFilter: null, blocks: mijBlocks() };
  return materializeScreen({ screen, hostOps });
}

