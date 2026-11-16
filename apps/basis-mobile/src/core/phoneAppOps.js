/**
 * The ops the phone mounts on the waist itself — the composable lists and basis's own ops — composed once.
 *
 * They were mounted inside CircleLauncherScreen. Every "+" entry in a circle's composer and in a contact thread calls
 * them (`embed-file`, `send-file`, the lists), so a test of "the phone sends a file" could reach them only by
 * reassembling the screen's mount. Here the launcher and the Node phone (test/support/mobileNode.js) call the SAME
 * function; what differs is exactly the `platform` argument: how this device picks a file, scans a code, asks a
 * question, opens a thread. The handlers are the shared ones (src/v2/listsOps.js, basis's createLocalBuiltins through
 * hostOps.js).
 *
 * No thread seams: the v2 shell has no thread surface, so `help-with` refuses in its own words rather than opening a
 * thread nothing paints — the same answer web gives.
 *
 * @param {object} p
 * @param {object} p.agent           bundle.agent (must offer `mountAppOps`; an older composition is left as it is)
 * @param {object} p.catalogue       bundle.catalogue
 * @param {function} p.callSkill     bundle.callSkill
 * @param {function} p.t
 * @param {object} p.eventLog
 * @param {object} [p.podAuth]
 * @param {object} [p.sessionRef]
 * @param {function} p.activeCircle  () => the open circle's id (the lists write there)
 * @param {object} p.platform        { openFilePicker, openQrScanner, openFeedback, confirmFeedbackOffer, feedbackCard,
 *                                     appVersion, currentScreen, showPersonCard }
 * @returns {boolean} whether anything was mounted
 */
import { listsManifest } from '../../../lists/manifest.js';
import { makeListsOps } from '../../../basis/src/v2/listsOps.js';
import { buildMobileLocalBuiltins } from './hostOps.js';

export function mountPhoneAppOps({ agent, catalogue, callSkill, t, eventLog, podAuth = null, sessionRef = null, activeCircle, platform }) {
  if (typeof agent?.mountAppOps !== 'function') return false;   // older composition — the agent's default serves
  // The composable LISTS on the waist — the SHARED handlers, web parity by construction. This hands them the three
  // things only a running shell has: which store, which translator, which circle is open.
  try {
    agent.mountAppOps('lists', makeListsOps({
      storeFor: (circleId) => agent.circleStoreFor?.(circleId),
      t,
      activeCircle,
      localActor: 'me',
    }), listsManifest);
  } catch { /* older composition */ }
  agent.mountAppOps('basis', buildMobileLocalBuiltins({
    agent, catalogue, callSkill, t, eventLog, podAuth, sessionRef,
    openFilePicker: platform.openFilePicker,
    openQrScanner: platform.openQrScanner,
    openFeedback: platform.openFeedback,
    confirmFeedbackOffer: platform.confirmFeedbackOffer,
    feedbackCard: platform.feedbackCard ?? null,
    appVersion: platform.appVersion ?? '',
    currentScreen: platform.currentScreen ?? null,
    showPersonCard: platform.showPersonCard,
  }));
  return true;
}
