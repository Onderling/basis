/**
 * THE PHONE'S POD READ-BACK, composed once: the shared `createPodReadBack` over the phone's pod chat catch-up, its
 * live circles read from pinboard. ChatScreen builds it once per launch and calls `onForeground` when the app comes back
 * to the front (AppState 'active'); opening a circle reaches it through the shared active circle. The phone in Node
 * builds the same one, so a story's "the phone comes back to the front" goes through this entry.
 */
import { createPodReadBack } from '../../../basis/src/v2/podReadBack.js';
import { myCircleIds } from '../../../basis/src/v2/myCircleIds.js';

/**
 * @param {{ podChatCatchUp: object|null, callSkill: Function }} a
 * @returns {ReturnType<typeof createPodReadBack>|null}  null without a pod chat catch-up (no pod circles)
 */
export function composePhonePodReadBack({ podChatCatchUp, callSkill }) {
  if (!podChatCatchUp || typeof callSkill !== 'function') return null;
  return createPodReadBack({
    catchUp: podChatCatchUp,
    listCircleIds: () => myCircleIds(callSkill),
  });
}
