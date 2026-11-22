/**
 * The circle offering draft an admin keeps on this device (`cc.circleSkill.<circleId>`), SEALED at rest (ledger L1083:
 * the person's offering per circle). One io for both shells, over localStorage (web) or AsyncStorage (phone): a read
 * before the content key is "nothing kept" (`null`), a save before it is refused.
 */
import { sealedJsonIo } from './localStoreSeal.js';

const keyOf = (circleId) => `cc.circleSkill.${circleId}`;

export function circleOfferingDraftIo(storage) {
  const io = sealedJsonIo(storage, { name: 'the offering draft', said: true });
  return {
    load: (circleId) => io.load(keyOf(circleId)),
    save: async (circleId, draft) => { try { await io.save(keyOf(circleId), draft); } catch { /* no content key yet */ } },
  };
}
