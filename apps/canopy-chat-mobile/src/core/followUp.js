/**
 * Conversational follow-up state machine for `needsForm` dispatches.
 *
 * MOVED to the shared package (`@canopy-app/canopy-chat` → `src/v2/followUp.js`) so the v2 kring
 * composers (web + mobile) elicit a missing field the same way the classic mobile chat does, from one
 * source. This file is now a thin re-export for back-compat — existing importers (ChatScreen, tests)
 * keep importing `../core/followUp.js` unchanged.
 */
export {
  beginFollowUp,
  beginFormFollowUp,
  completeFollowUp,
  completeMultiFieldFollowUp,
  pickPromptKey,
} from '@canopy-app/canopy-chat';
