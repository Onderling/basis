/**
 * THE PHONE'S POD SIGN-IN, the steps after a session is held. App.js runs them when its session restores or changes
 * and once the bundle is up; the phone in Node (test/support/mobileNode.js) runs the same two, so a story about a pod
 * circle on the phone signs in the way the app does.
 *   - the circle pods read the session (setCirclePodSession, done by the caller: it owns the session ref);
 *   - the shared-with-me writer is built from the session (`buildCirclePodWriter`);
 *   (pinboard's own item store is NOT attached to the pod: see scripts/lint-no-pinboard-pod-attach.mjs.)
 * Best-effort, as before: a step that cannot run leaves the phone as it was (signed out for that part).
 */
import { buildCirclePodWriter } from './circleStoresRN.js';

/**
 * The shared-with-me pod writer for the session (null while signed out).
 * @param {object|null} session
 */
export async function circlePodWriterFor(session) {
  return buildCirclePodWriter(session).catch(() => null);
}
