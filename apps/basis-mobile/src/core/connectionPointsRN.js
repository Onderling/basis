/**
 * The phone's connection points io, SEALED at rest (ledger L1083: which relays and pods the person's circles ride).
 *
 * The logic is the shared `asyncStorageConnectionPointsIo` (apps/basis/src/v2/connectionPoints.js); the shell only
 * chooses the storage it hands it. The phone hands a sealed one: every reader here runs after the content key exists
 * (`agentBundle.js` reads the points after `createRealHouseholdAgent`; the pods, the relay question and the launcher
 * read them on an act). The web hands plain localStorage, because it reads the points at module load, before its agent
 * exists (`circleApp.js`, the boot relay).
 */
import { asyncStorageConnectionPointsIo } from '../../../basis/src/v2/connectionPoints.js';
import { sealedKeyValue } from '../../../basis/src/v2/localStoreSeal.js';

/** @param {object} AsyncStorage  `@react-native-async-storage/async-storage` (or a test double) */
export function phoneConnectionPointsIo(AsyncStorage) {
  return asyncStorageConnectionPointsIo(sealedKeyValue(AsyncStorage, { name: 'the connection points', strict: true }));
}
