/**
 * THE RESTORE-FINISH FLOW'S LAST SCREEN — which sentence ends which branch, decided once for both shells (it was
 * written twice: web's painter and mobile's `RestoreFinishModal`). The flow itself is declared on the household
 * manifest (`restore-finish`) and run by the shared flow runner; a shell paints this and nothing it decides itself.
 *
 * @param {object} inst   the flow instance at its end
 * @returns {{ messageKey: string, retry: boolean, retiredCount: number }}
 *   `retry` — a retire ran and did not succeed: offer to try again; `retiredCount` — the devices a LOST-phone retire
 *   took out (said under the message; 0 otherwise).
 */
export function restoreFinishOutcome(inst) {
  const produces = inst?.produces ?? {};
  const retireOutcome = inst?.steps?.retire?.outcome;
  const sourceOutcome = inst?.steps?.source?.outcome;
  let messageKey;
  if (sourceOutcome === 'later') messageKey = 'circle.restore_finish.later_title';
  else if (sourceOutcome === 'not-your-file') messageKey = 'circle.restore_finish.err_not_yours';
  else if (sourceOutcome === 'unreadable-file') messageKey = 'circle.restore_finish.err_unreadable';
  else if (produces.intent === 'adding') messageKey = 'circle.restore_finish.done_adding';
  else if (retireOutcome === 'ok') messageKey = produces.intent === 'lost' ? 'circle.restore_finish.done_loud' : 'circle.restore_finish.done_quiet';
  else if (retireOutcome === 'wrong-phrase' || retireOutcome === 'invalid-phrase') messageKey = 'circle.enroll.invalid_phrase';
  else messageKey = 'circle.restore_finish.err_failed';
  const retired = inst?.steps?.retire?.out?.retiredDevices;
  const retiredCount = retireOutcome === 'ok' && produces.intent === 'lost' && Array.isArray(retired) ? retired.length : 0;
  return { messageKey, retry: !!retireOutcome && retireOutcome !== 'ok', retiredCount };
}
