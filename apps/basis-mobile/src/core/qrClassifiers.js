/**
 * basis-mobile QR classifiers — the SHARED list (`apps/basis/src/v2/scanRoute.js`), handed to
 * @onderling/react-native/qr's plug-in dispatcher (`classifyQrPayload(text, classifiers)`).
 *
 * The list used to live here; it moved to the shared router (2026-10-09) so the native scanner and Me → Scan (web: paste
 * a code) read one decision: contact · invite · pair · enroll · claim. What each kind accepts is documented there.
 */
import { SCAN_CLASSIFIERS } from '../../../basis/src/v2/scanRoute.js';

/**
 * @returns {Array<{kind: string, classify: (text: string) => unknown|null}>}
 */
export function getBasisClassifiers() {
  return [...SCAN_CLASSIFIERS];
}
