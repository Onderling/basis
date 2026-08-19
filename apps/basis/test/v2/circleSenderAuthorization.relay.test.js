/**
 * END-TO-END: who may speak in a circle, over a REAL relay and REAL sockets (Decision 1).
 *
 * ── Why this test exists at all ─────────────────────────────────────────────────────────────────
 * Decision 3 shipped a correct seam that nothing passed through, and it looked exactly like working
 * code. The roster authorize has the same shape and the same risk: a port in `packages/core`, an
 * implementation in `apps/basis/src/v2`, and a feed somewhere in between. Every one of those has
 * its own unit tests, and all three passing proves nothing about them being connected.
 *
 * So this crosses the seam for real. It boots an in-process relay, connects two REAL app agents to
 * it, drives a REAL circle join, and then puts a THIRD party on the same relay — a stranger with a
 * perfectly good Ed25519 identity, who registers an address of their own (proving possession, as
 * Decision 3 requires), seals a message to a member's per-circle address and signs it correctly.
 * Every cryptographic check passes. The envelope is refused anyway, because the key that signed it
 * is on nobody's roster — which is the entire point of Decision 1: **verify, then authorize.**
 *
 * The positive control is in the same file and matters as much: the member's own traffic still
 * arrives. A check that refuses everything is not a check, it is an outage.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startRelay } from '@onderling/relay';
import { AgentIdentity, SecurityLayer, mkEnvelope, P } from '@onderling/core';
// Relative, like `startRelay` above: `@onderling/transports` is not a dependency of this app (the
// shells reach transports through the secure-agent facade, invariant 5). A test that needs to BE a
// hostile peer needs the adapter itself, and reaching for it here is honest about that.
import { RelayTransport } from '../../../../packages/transports/src/RelayTransport.js';
import { VaultMemory } from '@onderling/vault';
import {
  bootRealAgentNode, connectAgentsOverRelay, pairCircle, until, teardown, sendCircleChat } from '../support/pairRealAgents.js';

const GROUP = 'circle-sender-authorize';
const rnd = () => Math.random().toString(36).slice(2, 8);
const settle = (ms = 200) => new Promise((r) => setTimeout(r, ms));

describe('a stranger cannot speak in a circle, however well they sign (real relay)', () => {
  let relay, relayUrl, admin, joiner, joined;

  beforeAll(async () => {
    relay = await startRelay({ port: 0, log: false });
    relayUrl = `ws://127.0.0.1:${relay.port}`;

    admin  = await bootRealAgentNode('admin');
    joiner = await bootRealAgentNode('joiner');
    await connectAgentsOverRelay(admin, joiner, { relayUrl });

    ({ joined } = await pairCircle(admin, joiner, {
      groupId: GROUP, name: 'Circle (authorize)', handle: 'joiner',
    }));

    // Warm the mesh exactly as the sibling relay test does: a real broadcast from the admin, which
    // is also the POSITIVE CONTROL — a member's traffic must still arrive with the check installed.
    const warm = `warmup-${rnd()}`;
    await sendCircleChat(admin, {
      groupId: GROUP, msgId: `w-${rnd()}`, text: warm,
    });
    await until(() => joiner.chatEvents.some((e) => e?.payload?.text === warm), { timeout: 10000 });
  }, 40000);

  afterAll(async () => {
    try { await teardown(admin, joiner); } catch { /* best-effort */ }
    try { await relay?.stop(); } catch { /* best-effort */ }
  });

  it('the join happened and the member\'s own broadcast arrived (positive control)', () => {
    expect(joined).toBeTruthy();
    expect(joiner.chatEvents.some((e) => e?.payload?.text?.startsWith('warmup-'))).toBe(true);
  });

  it('the authorize step is actually WIRED — an installed port with this circle recorded', () => {
    // Without this assertion the adversarial test below would still pass on a device where the
    // check refuses everything for the wrong reason, or where the roster was never recorded and the
    // refusal came from somewhere else entirely.
    const status = joiner.agent.circleSenderAuthorization();
    expect(status.installed, 'a sender authorizer is installed on the kernel').toBe(true);
    expect(status.circles, 'this circle\'s roster was recorded from the join').toBeGreaterThanOrEqual(1);
  });

  it('refuses a validly-signed envelope from a non-member, over a real socket', async () => {
    const victimAddress = joiner.agent.circleAddressFor(GROUP);
    expect(typeof victimAddress).toBe('string');

    // The stranger is not a fake: a real identity, a real relay registration (which under Decision 3
    // means they PROVED possession of the address they registered), a real signature, and the
    // payload really is sealed to the victim's per-circle key. Nothing about this envelope is
    // malformed — it is simply from someone who is not in the circle.
    const strangerId = await AgentIdentity.generate(new VaultMemory());
    const strangerSec = new SecurityLayer({ identity: strangerId });
    // Under one derivation (L2) a per-circle address IS its signing key, which is exactly how any
    // outsider who has seen the address can seal to it. That is the enumeration surface the design
    // names, and it is why this attack is worth defending rather than dismissing.
    strangerSec.registerPeer(victimAddress, victimAddress);
    const tx = new RelayTransport({ identity: strangerId, relayUrl });
    tx.useSecurityLayer(strangerSec);
    await tx.connect();
    await settle();

    const before = joiner.agent.circleSenderAuthorization();
    const forgedText = `stranger-${rnd()}`;
    await tx._send(victimAddress, mkEnvelope(P.OW, strangerId.pubKey, victimAddress, {
      type: 'p2p-chat', subtype: 'circle-chat-broadcast',
      groupId: GROUP, msgId: `s-${rnd()}`, text: forgedText, sentAt: Date.now(),
    }));
    await settle(600);

    const after = joiner.agent.circleSenderAuthorization();
    expect(after.refusedStrangers, 'the stranger\'s envelope was refused by the roster check')
      .toBe(before.refusedStrangers + 1);
    expect(joiner.chatEvents.some((e) => e?.payload?.text === forgedText),
      'and it never reached the application at all').toBe(false);

    await tx.disconnect?.();
  }, 30000);
});
