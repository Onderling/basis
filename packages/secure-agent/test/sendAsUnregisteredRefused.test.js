/**
 * A SEND THAT MUST SPEAK AS AN ADDRESS OF OURS WITH NO IDENTITY BEHIND IT IS REFUSED, NEVER SIGNED WITH THE MAIN KEY.
 *
 * A send that names `sendAs` (a per-circle address, a persona's) is a statement about WHO speaks. When no identity is
 * registered for that address (a circle key not yet derived, a persona not yet loaded), the send path used to sign with
 * the canonical identity and only warn: the circle and the relay then learned the person's main key, the one link the
 * per-circle address exists to withhold. Now: refused (the caller sees it), or held when the caller asked to hold — and
 * nothing reaches the wire either way.
 */
import { describe, it, expect } from 'vitest';
import { VaultMemory } from '@onderling/vault';
import { InternalBus, InternalTransport, deriveCircleAddress } from '@onderling/core';
import nacl from 'tweetnacl';
import { createSecureAgent } from '../src/createSecureAgent.js';

const FAST = { firstSendTimeoutMs: 600, retryDelays: [] };
const agent = (onPeerMessage) => createSecureAgent({ vault: new VaultMemory(), onPeerMessage, warnOnInsecure: false });

function watch(transport) {
  const log = [];
  const put = transport._put.bind(transport);
  transport._put = async (to, env) => { log.push(env); return put(to, env); };
  return log;
}

async function pair() {
  const bus = new InternalBus();
  const anna = await agent();
  const bram = await agent();
  const annaTx = new InternalTransport(bus, anna.identity.pubKey);
  await anna.addSecureTransport('relay', annaTx);
  await bram.addSecureTransport('relay', new InternalTransport(bus, bram.identity.pubKey));
  // the circle address is bound on the transport (as the app does), but NO identity is registered for it
  const circleAddress = deriveCircleAddress(new Uint8Array(nacl.randomBytes(32)), 'circle-x');
  await annaTx.addAddress(circleAddress);
  return { anna, bram, annaTx, circleAddress };
}

describe('a send as an unregistered address of ours', () => {
  it('is refused, and nothing signed by the main key reaches the wire', async () => {
    const { anna, bram, annaTx, circleAddress } = await pair();
    const wire = watch(annaTx);
    const r = anna.peer.sendTo(bram.identity.pubKey, { subtype: 'circle', text: 'hoi' }, { ...FAST, sendAs: circleAddress });
    await expect(r).rejects.toMatchObject({ code: 'SEND_AS_UNREGISTERED' });
    expect(wire, 'nothing left').toEqual([]);
  });

  it('is HELD when the caller asked to hold, and still nothing reaches the wire', async () => {
    const { anna, bram, annaTx, circleAddress } = await pair();
    const wire = watch(annaTx);
    const r = await anna.peer.sendTo(bram.identity.pubKey, { subtype: 'circle', text: 'hoi' },
      { ...FAST, sendAs: circleAddress, guarantee: 'hold-forward' });
    expect(r?.held, 'held, not sent as the main key').toBe(true);
    expect(wire).toEqual([]);
  });

  it('a send as the canonical address itself is just the canonical send', async () => {
    const { anna, bram } = await pair();
    await expect(anna.peer.sendTo(bram.identity.pubKey, { subtype: 'x' }, { ...FAST, sendAs: anna.identity.pubKey })).resolves.not.toThrow();
  });
});
