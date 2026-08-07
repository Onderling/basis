/**
 * tunnelReceiveSealed — Carol's entry point for a sealed hop-aware task
 * tunnel (Group CC3b).
 *
 * Flow:
 *   1. Bob's tunnel-open (sealed branch) calls this skill with the
 *      opaque sealed blob from Alice plus { tunnelId, bobAddr }.
 *   2. Carol unseals with her identity, cross-checks the sealed `origin`
 *      against the outer `sender`, and verifies the Group Z signature.
 *   3. Extracts the session key K and Alice's aliceTaskId from the
 *      sealed `extras` and stores them in agent._sealedTunnelKeys keyed
 *      by tunnelId.
 *   4. ACKs Bob immediately with { ack: true, tunnelId }.
 *   5. Runs the inner skill handler asynchronously — supporting
 *      async-generator streaming, Task.InputRequired, and cancel
 *      (via signal.aborted).  Each outbound OW is sealed with K and
 *      shipped back to Bob via the `tunnel-ow` skill with
 *      { sealedInner: { sealed, nonce } }.  Bob forwards opaquely as
 *      a `sealed-tunnel-ow` OW; Alice's handleTaskOneWay decrypts and
 *      dispatches locally.
 *
 * Inbound task-input / cancel from Alice arrive here as
 * `sealed-tunnel-ow` OWs (see taskExchange.js).  They are decrypted
 * there and re-dispatched through handleTaskOneWay's `task-input` /
 * `cancel` cases, which look up state in stateManager under
 * `ir:${taskId}` / `abort:${taskId}` — we register entries under those
 * keys so the existing dispatch works unchanged.
 *
 * See `Design-v3/hop-tunnel.md § 7`.
 */
import { Parts, DataPart }    from '../Parts.js';
import { openSealed }          from '../security/sealedForward.js';
import { sealTunnelOW }        from '../security/tunnelSeal.js';
import { verifyOrigin, ORIGIN_SIG_VERSION } from '../security/originSignature.js';

const isAsyncGen = (x) => x && typeof x[Symbol.asyncIterator] === 'function';

/**
 * Register the 'tunnel-receive-sealed' skill on an agent (no-op when already
 * registered). The handler unseals a sealed tunnel-open blob, verifies the
 * end-to-end origin signature, stores the tunnel session key, ACKs the bridge
 * immediately, and runs the inner skill asynchronously, streaming sealed one-way
 * updates back through the bridge.
 * @param {import('../Agent.js').Agent} agent
 * @param {object} [opts]
 * @param {'public'|'authenticated'|'trusted'|'private'} [opts.visibility='authenticated']
 */
export function registerTunnelReceiveSealed(agent, opts = {}) {
  if (agent.skills?.get?.('tunnel-receive-sealed')) return;

  const visibility = opts.visibility ?? 'authenticated';

  agent.register('tunnel-receive-sealed', async ({ parts, from, envelope }) => {
    const d = Parts.data(parts);
    if (!d?.sealed || !d?.nonce || !d?.sender || !d?.tunnelId || !d?.bobAddr) {
      return [DataPart({ error: 'missing sealed / nonce / sender / tunnelId / bobAddr' })];
    }

    // Unseal + sender/origin cross-check
    let inner;
    try {
      inner = openSealed({
        identity:     agent.identity,
        sealed:       d.sealed,
        nonce:        d.nonce,
        senderPubKey: d.sender,
      });
    } catch (err) {
      agent.emit?.('security-warning', {
        kind: 'tunnel-receive-sealed-open', reason: err.message, envelope,
      });
      return [DataPart({ error: `seal-open-failed: ${err.message}` })];
    }

    // Verify Group Z origin signature against (target=us, skill, parts, ts).
    const vRes = verifyOrigin(
      {
        origin: inner.origin,
        sig:    inner.originSig,
        body: {
          v:      ORIGIN_SIG_VERSION,
          target: agent.pubKey,
          skill:  inner.skill,
          parts:  inner.parts,
          ts:     inner.originTs,
        },
      },
      { expectedPubKey: agent.pubKey },
    );
    if (!vRes.ok) {
      agent.emit?.('security-warning', {
        kind: 'tunnel-receive-sealed-origin', reason: vRes.reason, envelope,
      });
      return [DataPart({ error: `origin-verify-failed: ${vRes.reason}` })];
    }

    // Extras: Alice ships the session key K and her local taskId inside
    // the sealed body so Bob never sees either.
    const K           = inner.extras?.tunnelKey;
    const aliceTaskId = inner.extras?.aliceTaskId;
    if (typeof K !== 'string' || !K) {
      return [DataPart({ error: 'missing tunnelKey in sealed body' })];
    }
    if (typeof aliceTaskId !== 'string' || !aliceTaskId) {
      return [DataPart({ error: 'missing aliceTaskId in sealed body' })];
    }

    // Resolve the inner skill.
    const innerSkill = agent.skills.get(inner.skill);
    if (!innerSkill || !innerSkill.enabled) {
      return [DataPart({
        error: innerSkill ? `Skill "${inner.skill}" is disabled`
                          : `Unknown skill: "${inner.skill}"`,
      })];
    }

    // Group-visibility gate (same as relay-receive-sealed): check the
    // verified origin's group membership, not the bridge's.
    const vis = innerSkill.visibility;
    if (typeof vis === 'object' && Array.isArray(vis?.groups)) {
      const gm = agent.security?.groupManager;
      let isMember = false;
      if (gm) {
        for (const gid of vis.groups) {
          try {
            if (await gm.hasValidProof(inner.origin, gid)) { isMember = true; break; }
          } catch { /* fail closed */ }
        }
      }
      if (!isMember) {
        return [DataPart({ error: `Unknown skill: "${inner.skill}"` })];
      }
    }

    // Register the session key so inbound sealed-tunnel-ow OWs can be
    // decrypted and re-dispatched into the normal task pipeline.
    agent._sealedTunnelKeys ??= new Map();
    agent._sealedTunnelKeys.set(d.tunnelId, {
      K,
      taskId:    aliceTaskId,       // symmetric: we use Alice's taskId
      side:      'carol',
      bobAddr:   d.bobAddr,
      aliceAddr: inner.origin,
    });

    agent.emit?.('tunnel-receive-sealed', {
      origin:    inner.origin,
      skill:     inner.skill,
      tunnelId:  d.tunnelId,
      relayedBy: from,
    });

    // Kick the runner off asynchronously — Bob's ACK returns immediately.
    // Any runner-level failure bubbles up through a tunnel-result OW.
    _runSealedSkill(agent, {
      tunnelId:   d.tunnelId,
      taskId:     aliceTaskId,
      bobAddr:    d.bobAddr,
      K,
      innerSkill,
      innerParts: inner.parts,
      origin:     inner.origin,
    }).catch(err => {
      // Runner bugs shouldn't crash the process — log and move on.
      agent.emit?.('skill-error', { skillId: inner.skill, error: err });
    });

    return [DataPart({ ack: true, tunnelId: d.tunnelId })];
  }, {
    visibility,
    description: 'Receive a sealed tunnel open (Group CC3b) — runs the inner skill and streams OWs back through the bridge',
  });
}

// ── Runner ───────────────────────────────────────────────────────────────────

async function _runSealedSkill(agent, ctx) {
  const {
    tunnelId, taskId, bobAddr, K,
    innerSkill, innerParts, origin,
  } = ctx;

  const abortController = new AbortController();
  // Register an abort entry so handleTaskOneWay's 'cancel' case (after
  // sealed-tunnel-ow decryption) reaches us without any custom wiring.
  agent.stateManager?.createTask?.(`abort:${taskId}`, { controller: abortController });

  const sendSealedOW = (innerOW) => _sendSealedOW(agent, { tunnelId, bobAddr, K, innerOW });

  const handlerCtx = {
    parts:          innerParts,
    from:           bobAddr,            // immediate caller (bridge)
    originFrom:     origin,             // verified end-to-end origin
    originVerified: true,
    relayedBy:      bobAddr,
    agent,
    signal:         abortController.signal,
  };

  const cleanup = () => {
    agent.stateManager?.deleteTask?.(`abort:${taskId}`);
    agent.stateManager?.deleteTask?.(`ir:${taskId}`);
    agent._sealedTunnelKeys?.delete?.(tunnelId);
  };

  let result;
  try {
    result = await innerSkill.handler(handlerCtx);
  } catch (err) {
    if (err?.name === 'InputRequired') {
      try {
        result = await _runIRLoop(agent, {
          taskId, innerSkill, handlerCtx, abortController, sendSealedOW, initial: err,
        });
      } catch (loopErr) {
        if (!abortController.signal.aborted) {
          await sendSealedOW({
            type: 'tunnel-result', status: 'failed', parts: [],
            error: loopErr?.message ?? String(loopErr),
          });
        } else {
          await sendSealedOW({ type: 'tunnel-result', status: 'cancelled', parts: [] });
        }
        cleanup();
        return;
      }
    } else if (abortController.signal.aborted) {
      await sendSealedOW({ type: 'tunnel-result', status: 'cancelled', parts: [] });
      cleanup();
      return;
    } else {
      await sendSealedOW({
        type: 'tunnel-result', status: 'failed', parts: [],
        error: err?.message ?? String(err),
      });
      cleanup();
      return;
    }
  }

  // Handler returned (maybe post-IR-resume).  Stream if async-gen.
  if (isAsyncGen(result)) {
    try {
      for await (const chunk of result) {
        if (abortController.signal.aborted) { result.return?.(); break; }
        const chunkParts = chunk == null ? []
          : Array.isArray(chunk) ? chunk
          : Parts.wrap(chunk);
        await sendSealedOW({ type: 'stream-chunk', parts: chunkParts });
      }
      if (abortController.signal.aborted) {
        await sendSealedOW({ type: 'tunnel-result', status: 'cancelled', parts: [] });
      } else {
        await sendSealedOW({ type: 'tunnel-result', status: 'completed', parts: [] });
      }
    } catch (err) {
      await sendSealedOW({
        type: 'tunnel-result', status: 'failed', parts: [],
        error: err?.message ?? String(err),
      });
    }
  } else {
    const outParts = result == null ? []
      : Array.isArray(result)      ? result
      : Parts.wrap(result);
    await sendSealedOW({ type: 'tunnel-result', status: 'completed', parts: outParts });
  }

  cleanup();
}

async function _runIRLoop(agent, {
  taskId, innerSkill, handlerCtx, abortController, sendSealedOW, initial,
}) {
  let curErr = initial;
  let curCtx = handlerCtx;

  while (true) {
    if (abortController.signal.aborted) throw new Error('aborted');

    // Register the `ir:${taskId}` resolver BEFORE shipping the IR OW.
    // Otherwise Alice's task-input can land before the resolver is in
    // place — the bridge round-trip for our own tunnel-ow RQ doesn't
    // finish until after Bob forwards AND Alice replies, and her reply
    // arrives through a separate OW that can race the RS.  Registering
    // first guarantees the resolver is live when handleTaskOneWay's
    // task-input case looks it up.
    const inputPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Input-required timeout')), 120_000);
      agent.stateManager?.createTask?.(`ir:${taskId}`, {
        resolver: (p)   => { clearTimeout(timer); resolve(p); },
        rejecter: (err) => { clearTimeout(timer); reject(err); },
      });
    });

    // Ship the IR prompt to Alice through the tunnel.
    await sendSealedOW({ type: 'input-required', parts: curErr.parts ?? [] });

    let inputParts;
    try {
      inputParts = await inputPromise;
    } catch (err) {
      throw err;
    }

    if (abortController.signal.aborted) throw new Error('aborted');

    curCtx = { ...curCtx, parts: inputParts };
    try {
      return await innerSkill.handler(curCtx);
    } catch (err) {
      if (err?.name === 'InputRequired') { curErr = err; continue; }
      throw err;
    }
  }
}

async function _sendSealedOW(agent, { tunnelId, bobAddr, K, innerOW }) {
  try {
    const { sealed, nonce } = sealTunnelOW({ key: K, innerOW });
    await agent.invoke(
      bobAddr,
      'tunnel-ow',
      [DataPart({ tunnelId, sealedInner: { sealed, nonce } })],
      { timeout: 5_000 },
    );
  } catch { /* best-effort; Alice's own timeouts cover chronic unreachability */ }
}
