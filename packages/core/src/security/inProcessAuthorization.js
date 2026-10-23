/**
 * The roster of an INTERNAL BUS — the sender authorizer for a layer that faces no wire.
 *
 * An in-process agent hears only the agents of its own process, and the keys it may hear are exactly the ones
 * `SecurityLayer.adoptInProcessPeer` bound on its bus: a closed set this process built from the objects themselves.
 * So its roster is not membership knowledge (that stays out of the kernel, `senderAuthorization.js`); it is the
 * layer's own adoption record, read live at check time — adoption happens after construction, and a rotation that
 * migrates an adopted key is followed. Fail-closed: a layer that has adopted nobody admits nobody, and a key the bus
 * did not adopt is refused even when it signs correctly.
 */
import { allowSender, refuseSender } from './senderAuthorization.js';

/** The verdict reasons this authorizer gives. */
export const IN_PROCESS_SENDER = Object.freeze({
  ADOPTED:      'in-process-peer',
  NOT_ADOPTED:  'not-an-in-process-peer',
  NONE_ADOPTED: 'no-in-process-peer-adopted',
});

/**
 * The sender authorizer for an in-process layer: admits a key only if the layer adopted it on its bus
 * (`adoptInProcessPeer`), read at check time; refuses everything while nothing is adopted.
 *
 * @param {{inProcessPeerKeys: () => Set<string>}} layer   the layer it is installed on
 * @returns {(context: {senderKey: string}) => {allow: boolean, reason: string}}
 */
export function createInProcessSenderAuthorizer(layer) {
  return ({ senderKey } = {}) => {
    let keys;
    try { keys = layer?.inProcessPeerKeys?.(); } catch { keys = null; }
    if (!(keys instanceof Set) || keys.size === 0) return refuseSender(IN_PROCESS_SENDER.NONE_ADOPTED);
    return keys.has(senderKey) ? allowSender(IN_PROCESS_SENDER.ADOPTED) : refuseSender(IN_PROCESS_SENDER.NOT_ADOPTED);
  };
}
