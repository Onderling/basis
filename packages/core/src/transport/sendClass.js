/**
 * Which sends may wait behind what a person waits on (the start burst, 2026-11-20).
 *
 * A transport that paces its sends (the relay transport, under the relay's per-connection limit) sends background
 * frames after foreground ones: `Transport.sendOneWay(to, payload, { background: true })` hands the class to `_put`
 * beside the envelope, never on the wire. The secure agent decides the class from the payload's own subtype, here, so
 * no caller needs a knob; a test in basis pins that every lane's catch-up subtypes are read as background.
 */

/**
 * A send nobody waits on: a lane's catch-up (`*-catchup-request|batch|offer`, the naming every lane uses) or the
 * per-boot address re-announce. Everything else is foreground, so nothing a person does gets slower by accident.
 * @param {object} payload
 * @returns {boolean}
 */
export function isBackgroundSend(payload) {
  const st = payload?.subtype;
  return typeof st === 'string' && (/-catchup-(request|batch|offer)$/.test(st) || st === 'circle-address-announce');
}
