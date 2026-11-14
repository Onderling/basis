/**
 * THE PHONE'S POD SIGN-IN, the steps after a session is held. App.js runs them when its session restores or changes
 * and once the bundle is up; the phone in Node (test/support/mobileNode.js) runs the same two, so a story about a pod
 * circle on the phone signs in the way the app does.
 *   - the circle pods read the session (setCirclePodSession, done by the caller: it owns the session ref);
 *   - the shared-with-me writer is built from the session (`buildCirclePodWriter`);
 *   - pinboard's item store is attached to the person's real pod (`attachPinboardPod`), the root found from the WebID.
 * Best-effort, as before: a step that cannot run leaves the phone as it was (signed out for that part).
 */
import { buildCirclePodWriter } from './circleStoresRN.js';
import { discoverPodRoot } from '../../../basis/src/web/podStorage.js';

/**
 * Attach pinboard's item store to the signed-in person's pod.
 * @param {{ session: object|null, agent: object|null }} a
 * @returns {Promise<boolean>} whether an attach was started
 */
export async function attachPinboardPodFor({ session, agent }) {
  if (!agent?.attachPinboardPod || !session?.isAuthenticated?.() || !session.webid) return false;
  const sessionShim = { fetch: session.getAuthenticatedFetch(), webid: session.webid };
  const podRoot = await discoverPodRoot(sessionShim).catch(() => null);
  if (!podRoot) return false;
  agent.attachPinboardPod({ podRoot, webid: session.webid, fetch: sessionShim.fetch }).catch(() => {});
  return true;
}

/**
 * The shared-with-me pod writer for the session (null while signed out).
 * @param {object|null} session
 */
export async function circlePodWriterFor(session) {
  return buildCirclePodWriter(session).catch(() => null);
}
